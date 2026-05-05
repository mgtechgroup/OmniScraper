import puppeteer from 'puppeteer';
import { ScrapingError, CircuitBreakerError } from '../errors/index.js';
import config from '../config/index.js';
import logger from '../logger/index.js';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeout = options.resetTimeout || 60000;
    this.failures = 0;
    this.state = 'CLOSED';
    this.nextAttempt = Date.now();
  }

  async exec(fn) {
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttempt) {
        throw new CircuitBreakerError('IMDB');
      }
      this.state = 'HALF_OPEN';
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  onSuccess() {
    this.failures = 0;
    this.state = 'CLOSED';
  }

  onFailure() {
    this.failures++;
    if (this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + this.resetTimeout;
    }
  }
}

export class IMDBPlugin {
  constructor() {
    this.manifest = {
      name: 'imdb',
      version: '1.0.0',
      category: 'scraper',
      description: 'IMDB movie and TV show scraper using Puppeteer',
      author: 'OmniScraper',
      endpoints: ['/api/v1/scrape/imdb/top', '/api/v1/scrape/imdb/movie/:id', '/api/v1/scrape/imdb/search'],
      dependencies: ['puppeteer']
    };
    this.browser = null;
    this.circuitBreaker = new CircuitBreaker();
    this.lastRequest = 0;
    this.rateLimitMs = 2000;
    this.cache = new Map();
    this.cacheTTL = 300000;
  }

  async init() {
    this.browser = await puppeteer.launch({
      headless: 'new',
      args: config.puppeteerArgs
    });
  }

  async getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  }

  async getPage() {
    const page = await this.browser.newPage();
    await page.setUserAgent(await this.getRandomUserAgent());
    await page.setViewport({
      width: 1280 + Math.floor(Math.random() * 200),
      height: 720 + Math.floor(Math.random() * 200)
    });
    return page;
  }

  async enforceRateLimit() {
    const now = Date.now();
    const elapsed = now - this.lastRequest;
    if (elapsed < this.rateLimitMs) {
      await new Promise(r => setTimeout(r, this.rateLimitMs - elapsed));
    }
    this.lastRequest = Date.now();
  }

  getCached(key) {
    const entry = this.cache.get(key);
    if (entry && Date.now() - entry.timestamp < this.cacheTTL) {
      return entry.data;
    }
    this.cache.delete(key);
    return null;
  }

  setCache(key, data) {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  async getTopMovies(limit = 50) {
    const cacheKey = `top_movies_${limit}`;
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    return this.circuitBreaker.exec(async () => {
      await this.enforceRateLimit();
      const page = await this.getPage();
      try {
        await page.goto('https://www.imdb.com/chart/top', { waitUntil: 'networkidle2', timeout: config.timeouts.scraping });
        const movies = await page.evaluate((lim) => {
          const items = document.querySelectorAll('.ipc-media-list-card__content');
          return Array.from(items).slice(0, lim).map((item, idx) => {
            const titleEl = item.querySelector('.ipc-title__text');
            const ratingEl = item.querySelector('.ipc-rating-star--rating');
            const linkEl = item.closest('a') || item.querySelector('a');
            return {
              rank: idx + 1,
              title: titleEl?.textContent?.trim() || '',
              rating: ratingEl?.textContent?.trim() || '',
              url: linkEl ? 'https://www.imdb.com' + linkEl.getAttribute('href') : ''
            };
          });
        }, limit);
        this.setCache(cacheKey, movies);
        return movies;
      } finally {
        await page.close();
      }
    });
  }

  async getMovieDetails(id) {
    const cacheKey = `movie_${id}`;
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    return this.circuitBreaker.exec(async () => {
      await this.enforceRateLimit();
      const page = await this.getPage();
      try {
        const url = `https://www.imdb.com/title/${id}/`;
        await page.goto(url, { waitUntil: 'networkidle2', timeout: config.timeouts.scraping });
        const details = await page.evaluate(() => {
          return {
            title: document.querySelector('h1')?.textContent?.trim() || '',
            year: document.querySelector('[data-testid="title-details-releasedate"]')?.textContent?.trim() || '',
            rating: document.querySelector('[data-testid="hero-rating-bar__aggregate-rating__score"] span')?.textContent?.trim() || '',
            plot: document.querySelector('[data-testid="plot-xs_to_m"]')?.textContent?.trim() || '',
            genres: Array.from(document.querySelectorAll('[data-testid="genres"] a')).map(a => a.textContent.trim()),
            director: document.querySelector('[data-testid="title-pc-principal-credit"] a')?.textContent?.trim() || ''
          };
        });
        details.id = id;
        this.setCache(cacheKey, details);
        return details;
      } finally {
        await page.close();
      }
    });
  }

  async searchMovies(query) {
    const cacheKey = `search_${query}`;
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    return this.circuitBreaker.exec(async () => {
      await this.enforceRateLimit();
      const page = await this.getPage();
      try {
        const url = `https://www.imdb.com/find?q=${encodeURIComponent(query)}`;
        await page.goto(url, { waitUntil: 'networkidle2', timeout: config.timeouts.scraping });
        const results = await page.evaluate(() => {
          const items = document.querySelectorAll('.ipc-metadata-list-summary-item');
          return Array.from(items).slice(0, 20).map(item => {
            const link = item.querySelector('a');
            const title = item.querySelector('.ipc-title__text');
            return {
              title: title?.textContent?.trim() || '',
              url: link ? 'https://www.imdb.com' + link.getAttribute('href') : '',
              id: link?.getAttribute('href')?.match(/\/title\/(tt\d+)/)?.[1] || ''
            };
          });
        });
        this.setCache(cacheKey, results);
        return results;
      } finally {
        await page.close();
      }
    });
  }

  async start() { logger.info('IMDB plugin started'); }
  async stop() { if (this.browser) await this.browser.close(); }
  async destroy() { await this.stop(); }
}

export default IMDBPlugin;
