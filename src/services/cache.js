import Keyv from 'keyv';
import fs from 'node:fs';
import path from 'node:path';
import config from '../config/index.js';
import logger from '../logger/index.js';

class CacheNamespace {
  constructor(store, namespace) {
    this.store = store;
    this.namespace = namespace;
  }

  _key(key) {
    return `${this.namespace}:${key}`;
  }

  async get(key) {
    return this.store.get(this._key(key));
  }

  async set(key, value, ttl) {
    return this.store.set(this._key(key), value, ttl);
  }

  async delete(key) {
    return this.store.delete(this._key(key));
  }

  async clear() {
    return this.store.clear();
  }
}

export class CacheService {
  constructor() {
    this.store = null;
    this.namespaces = new Map();
    this.stats = { hits: 0, misses: 0, sets: 0, deletes: 0 };
  }

  async init() {
    try {
      if (config.redisUrl) {
        const KeyvRedis = (await import('keyv-redis')).default;
        this.store = new Keyv({ store: new KeyvRedis(config.redisUrl) });
        logger.info('Cache initialized with Redis backend');
      } else {
        this.store = new Keyv();
        logger.info('Cache initialized with in-memory store');
      }

      this.store.on('error', (err) => {
        logger.error({ error: err.message }, 'Cache error');
      });
    } catch (err) {
      logger.warn({ error: err.message }, 'Falling back to in-memory cache');
      this.store = new Keyv();
    }
  }

  namespace(name) {
    if (!this.namespaces.has(name)) {
      this.namespaces.set(name, new CacheNamespace(this.store, name));
    }
    return this.namespaces.get(name);
  }

  async get(key) {
    const value = await this.store.get(key);
    if (value !== undefined) this.stats.hits++;
    else this.stats.misses++;
    return value;
  }

  async set(key, value, ttl) {
    this.stats.sets++;
    return this.store.set(key, value, ttl);
  }

  async delete(key) {
    this.stats.deletes++;
    return this.store.delete(key);
  }

  async clear() {
    return this.store.clear();
  }

  getStats() {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      hitRate: total > 0 ? (this.stats.hits / total * 100).toFixed(2) + '%' : '0%',
      missRate: total > 0 ? (this.stats.misses / total * 100).toFixed(2) + '%' : '0%'
    };
  }

  async invalidateByPattern(pattern) {
    if (typeof this.store.iterator === 'function') {
      const iterator = this.store.iterator();
      for await (const [key] of iterator) {
        if (key.match(pattern)) {
          await this.delete(key);
        }
      }
    }
  }
}

export default CacheService;
