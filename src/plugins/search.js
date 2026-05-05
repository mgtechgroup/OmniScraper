import { ScrapingError } from '../errors/index.js';
import config from '../config/index.js';
import logger from '../logger/index.js';

export class SearchPlugin {
  constructor(registry) {
    this.manifest = {
      name: 'search',
      version: '1.0.0',
      category: 'search',
      description: 'Unified search across all data sources',
      author: 'OmniScraper',
      endpoints: ['/api/v1/search', '/api/v1/search/:type'],
      dependencies: []
    };
    this.registry = registry;
    this.cache = new Map();
    this.cacheTTL = 30000;
  }

  async search(query, options = {}) {
    const { type = 'all', limit = 50, offset = 0 } = options;
    const cacheKey = `search_${query}_${type}_${limit}_${offset}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.data;
    }

    const results = [];
    const errors = [];

    const searches = [];

    if ((type === 'all' || type === 'movie') && this.registry.get('imdb')) {
      searches.push(
        this.registry.get('imdb').searchMovies(query).then(movies => {
          results.push(...movies.map(m => ({ ...m, type: 'movie', source: 'imdb' })));
        }).catch(e => errors.push({ source: 'imdb', error: e.message }))
      );
    }

    if ((type === 'all' || type === 'scrape') && this.registry.get('universal')) {
      const scraperNames = this.registry.get('universal').getScraperNames();
      for (const name of scraperNames.slice(0, 5)) {
        searches.push(
          Promise.resolve().then(async () => {
            const scraper = this.registry.get('universal').scrapers.get(name);
            if (scraper.baseUrl) {
              const data = await this.registry.get('universal').runScraper(name, scraper.baseUrl);
              results.push({ type: 'scrape', source: name, data, query });
            }
          }).catch(e => errors.push({ source: name, error: e.message }))
        );
      }
    }

    if ((type === 'all' || type === 'torrent') && this.registry.get('torrent')) {
      searches.push(
        this.registry.get('torrent').searchDHT(query).then(torrents => {
          results.push(...torrents.map(t => ({ ...t, type: 'torrent', source: 'dht' })));
        }).catch(e => errors.push({ source: 'torrent', error: e.message }))
      );
    }

    if ((type === 'all' || type === 'music') && this.registry.get('music')) {
      searches.push(
        Promise.resolve().then(async () => {
          const nowPlaying = this.registry.get('music').nowPlaying;
          if (nowPlaying && (nowPlaying.track?.toLowerCase().includes(query.toLowerCase()) ||
              nowPlaying.artist?.toLowerCase().includes(query.toLowerCase()))) {
            results.push({ ...nowPlaying, type: 'music', source: 'music' });
          }
        }).catch(e => errors.push({ source: 'music', error: e.message }))
      );
    }

    await Promise.allSettled(searches);

    const ranked = results
      .sort((a, b) => {
        const scoreA = this._rankResult(a, query);
        const scoreB = this._rankResult(b, query);
        return scoreB - scoreA;
      })
      .slice(offset, offset + limit);

    const response = {
      query,
      total: ranked.length,
      offset,
      limit,
      results: ranked,
      errors: errors.length > 0 ? errors : undefined,
      timestamp: new Date().toISOString()
    };

    this.cache.set(cacheKey, { data: response, timestamp: Date.now() });
    return response;
  }

  _rankResult(result, query) {
    let score = 0;
    const q = query.toLowerCase();
    const text = JSON.stringify(result).toLowerCase();
    if (text.includes(q)) score += 10;
    if (result.title?.toLowerCase() === q || result.track?.toLowerCase() === q) score += 50;
    if (result.rating) score += parseFloat(result.rating) || 0;
    if (result.type === 'movie') score += 5;
    return score;
  }

  async start() { logger.info('Search plugin started'); }
  async stop() { this.cache.clear(); }
  async destroy() { this.cache.clear(); }
}

export default SearchPlugin;
