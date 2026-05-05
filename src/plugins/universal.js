import * as cheerioModule from 'cheerio';
const cheerio = cheerioModule.default || cheerioModule;
import axios from 'axios';
import yaml from 'yaml';
import fs from 'node:fs';
import path from 'node:path';
import { ScrapingError, RateLimitError } from '../errors/index.js';
import config from '../config/index.js';
import logger from '../logger/index.js';

export class UniversalPlugin {
  constructor() {
    this.manifest = {
      name: 'universal',
      version: '1.0.0',
      category: 'scraper',
      description: 'Universal web scraper with YAML-based definitions',
      author: 'OmniScraper',
      endpoints: ['/api/v1/scrape/universal/:scraper', '/api/v1/scrape/universal/run'],
      dependencies: ['cheerio', 'axios', 'yaml']
    };
    this.scrapers = new Map();
    this.activeRequests = 0;
    this.maxConcurrent = 10;
    this.proxyIndex = 0;
    this.cache = new Map();
  }

  async init() {
    await this.loadScraperDefinitions();
  }

  async loadScraperDefinitions() {
    const yamlDir = path.resolve('scrapers');
    if (!fs.existsSync(yamlDir)) {
      fs.mkdirSync(yamlDir, { recursive: true });
      return;
    }

    const files = fs.readdirSync(yamlDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(yamlDir, file), 'utf8');
        const definition = yaml.parse(content);
        if (definition.name) {
          this.scrapers.set(definition.name, definition);
          logger.info({ scraper: definition.name }, `Loaded scraper: ${definition.name}`);
        }
      } catch (err) {
        logger.error({ file, error: err.message }, `Failed to load scraper: ${file}`);
      }
    }
  }

  getProxy() {
    if (config.proxyList.length === 0) return null;
    const proxy = config.proxyList[this.proxyIndex % config.proxyList.length];
    this.proxyIndex++;
    return proxy;
  }

  async waitForSlot() {
    while (this.activeRequests >= this.maxConcurrent) {
      await new Promise(r => setTimeout(r, 100));
    }
    this.activeRequests++;
  }

  releaseSlot() {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
  }

  async scrape(definition, url, options = {}) {
    const cacheKey = `scrape_${definition.name}_${url}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < config.cache.ttl.scrape) {
      return cached.data;
    }

    await this.waitForSlot();
    try {
      const proxy = this.getProxy();
      const response = await axios.get(url, {
        timeout: config.timeouts.scraping,
        proxy: proxy ? { host: proxy } : undefined,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      const $ = cheerio.load(response.data);
      const results = {};

      if (definition.extract) {
        for (const [key, selector] of Object.entries(definition.extract)) {
          if (typeof selector === 'string') {
            results[key] = $(selector).first().text().trim();
          } else if (selector.type === 'css') {
            if (selector.multiple) {
              results[key] = $(selector.selector).map((_, el) => $(el).text().trim()).get();
            } else {
              results[key] = $(selector.selector).first().text().trim();
            }
          } else if (selector.type === 'regex') {
            const match = response.data.match(new RegExp(selector.pattern));
            results[key] = match ? match[1] || match[0] : '';
          }
        }
      }

      this.cache.set(cacheKey, { data: results, timestamp: Date.now() });
      return results;
    } catch (err) {
      throw new ScrapingError(`Failed to scrape ${url}: ${err.message}`, definition.name);
    } finally {
      this.releaseSlot();
    }
  }

  async runScraper(name, url, options = {}) {
    const definition = this.scrapers.get(name);
    if (!definition) {
      throw new Error(`Scraper ${name} not found`);
    }
    return this.scrape(definition, url, options);
  }

  async runBatch(scraperName, urls, options = {}) {
    const results = [];
    for (const url of urls) {
      try {
        const data = await this.runScraper(scraperName, url, options);
        results.push({ url, data, success: true });
      } catch (err) {
        results.push({ url, error: err.message, success: false });
      }
    }
    return results;
  }

  getScraperNames() {
    return Array.from(this.scrapers.keys());
  }

  async start() { logger.info('Universal scraper plugin started'); }
  async stop() { this.cache.clear(); }
  async destroy() { this.scrapers.clear(); this.cache.clear(); }
}

export default UniversalPlugin;
