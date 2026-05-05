/**
 * Stremio Integration Plugin for OmniScraper
 *
 * Provides search across Stremio addons (Cinema, YouTube, etc.)
 * Compatible with OmniScraper unified search results format.
 *
 * Methods:
 *   - searchCatalog(query, type, opts)  - Search across Stremio addon catalogs
 *   - streamDetails(id, type, opts)     - Get streaming details for a media item
 *   - getAddonManifest(url, opts)       - Fetch and cache addon manifest (5min TTL)
 *
 * Features:
 *   - Caches addon manifests (5min TTL)
 *   - Timeout handling (10s per addon)
 *   - Error handling (skip failed addons, return partial results)
 *   - Unified result format compatible with OmniScraper search
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

// ─── Configuration ───────────────────────────────────────────────────────────────

const DEFAULT_ADDONS = [
  {
    name: 'Cinemeta',
    url: 'https://v3-cinemeta.strem.io/manifest.json',
    types: ['movie', 'series'],
    resources: ['catalog', 'meta', 'stream'],
    enabled: true,
  },
  {
    name: 'YouTube',
    url: 'https://stremio-youtube-addon.strem.io/manifest.json',
    types: ['channel', 'tv'],
    resources: ['catalog', 'meta', 'stream'],
    enabled: true,
  },
  {
    name: 'OpenSubtitles',
    url: 'https://opensubtitles.strem.io/manifest.json',
    types: ['movie', 'series'],
    resources: ['subtitles'],
    enabled: true,
  },
  {
    name: 'ThePirateBay',
    url: 'https://stremio-thepiratebay.strem.io/manifest.json',
    types: ['movie', 'series'],
    resources: ['stream'],
    enabled: true,
  },
  {
    name: 'RARBG',
    url: 'https://stremio-rarbg.strem.io/manifest.json',
    types: ['movie', 'series'],
    resources: ['stream'],
    enabled: false,
  },
  {
    name: '1337x',
    url: 'https://stremio-1337x.strem.io/manifest.json',
    types: ['movie', 'series'],
    resources: ['stream'],
    enabled: true,
  },
];

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const ADDON_TIMEOUT_MS = 10000;     // 10 seconds per addon
const STREMIO_SERVER_URL = process.env.STREMIO_SERVER_URL || 'http://localhost:11470';
const STREMIO_ADDONS_URL = process.env.STREMIO_ADDONS_URL || 'http://localhost:7000';

// ─── In-Memory Cache ─────────────────────────────────────────────────────────────

const manifestCache = new Map(); // url -> { data, timestamp }
const searchCache = new Map();   // cacheKey -> { results, timestamp }

function getCached(key, cache, ttl = CACHE_TTL_MS) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < ttl) {
    return entry.data;
  }
  cache.delete(key);
  return undefined;
}

function setCache(key, data, cache) {
  cache.set(key, { data, timestamp: Date.now() });
}

// ─── HTTP Fetch with Timeout ─────────────────────────────────────────────────────

function fetchWithTimeout(url, opts = {}) {
  const timeoutMs = opts.timeout || ADDON_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const protocol = url.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    const req = protocol.get(url, { signal: controller.signal, ...opts }, (res) => {
      clearTimeout(timeoutId);
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf8');
          resolve({ ok: true, status: res.statusCode, json: () => JSON.parse(body), text: () => body });
        } catch (e) {
          reject(new Error(`Parse error from ${url}: ${e.message}`));
        }
      });
    });
    req.on('error', (err) => {
      clearTimeout(timeoutId);
      reject(new Error(`Request failed to ${url}: ${err.message}`));
    });
    req.on('timeout', () => {
      clearTimeout(timeoutId);
      req.destroy();
      reject(new Error(`Timeout to ${url} after ${timeoutMs}ms`));
    });
  });
}

async function fetchJSON(url, opts = {}) {
  const res = await fetchWithTimeout(url, opts);
  return res.json();
}

// ─── Addon Manifest ──────────────────────────────────────────────────────────────

async function getAddonManifest(url, opts = {}) {
  const ttl = opts.cacheTTL || CACHE_TTL_MS;
  const cached = getCached(url, manifestCache, ttl);
  if (cached) return cached;

  try {
    const manifest = await fetchJSON(url, { timeout: opts.timeout || ADDON_TIMEOUT_MS });
    if (!manifest || !manifest.id) {
      throw new Error('Invalid manifest: missing id');
    }
    setCache(url, manifest, manifestCache);
    return manifest;
  } catch (err) {
    if (opts.throwOnError) throw err;
    console.error(`[stremio-plugin] Manifest fetch failed for ${url}:`, err.message);
    return null;
  }
}

// ─── Catalog Search ──────────────────────────────────────────────────────────────

async function searchCatalog(query, type = null, opts = {}) {
  const {
    addons = DEFAULT_ADDONS,
    timeout = ADDON_TIMEOUT_MS,
    skipErrors = true,
    limit = 50,
  } = opts;

  const cacheKey = `search:${query}:${type || 'all'}`;
  const cached = getCached(cacheKey, searchCache, CACHE_TTL_MS);
  if (cached) return cached;

  const results = [];
  const enabledAddons = addons.filter((a) => a.enabled !== false);

  await Promise.allSettled(
    enabledAddons.map(async (addon) => {
      try {
        const manifest = await getAddonManifest(addon.url, { timeout, throwOnError: false });
        if (!manifest) return;

        const catalogs = manifest.catalogs || [];
        for (const catalog of catalogs) {
          if (type && catalog.type !== type) continue;

          try {
            const catalogUrl = addon.url.replace(
              '/manifest.json',
              `/catalog/${catalog.type}/${catalog.id}/${encodeURIComponent(query)}.json`
            );
            const data = await fetchJSON(catalogUrl, { timeout });
            const metas = data.metas || data.results || [];

            for (const meta of metas.slice(0, Math.ceil(limit / enabledAddons.length))) {
              results.push({
                // OmniScraper unified format
                id: meta.id,
                title: meta.name || meta.title || 'Unknown',
                type: meta.type || catalog.type,
                poster: meta.poster || meta.posterShape || null,
                backdrop: meta.background || meta.backdrop || null,
                description: meta.description || null,
                year: meta.year || null,
                releaseInfo: meta.releaseInfo || null,
                genres: meta.genres || [],
                rating: meta.rating || meta.imdbRating || null,
                runtime: meta.runtime || null,
                director: meta.director || null,
                cast: meta.cast || [],
                // Stremio-specific
                addon: addon.name,
                addonUrl: addon.url,
                catalog: catalog.id,
                // Streaming URLs (if available)
                streams: meta.streams || null,
                // Compatibility
                source: 'stremio',
                sourceType: 'streaming',
                url: `${STREMIO_SERVER_URL}/stream/${meta.type || catalog.type}/${meta.id}`,
              });
            }
          } catch (err) {
            if (!skipErrors) throw err;
            console.error(
              `[stremio-plugin] Catalog search failed [${addon.name}/${catalog.id}]:`,
              err.message
            );
          }
        }
      } catch (err) {
        if (!skipErrors) throw err;
        console.error(`[stremio-plugin] Addon processing failed [${addon.name}]:`, err.message);
      }
    })
  );

  const uniqueResults = deduplicateResults(results);
  const limitedResults = uniqueResults.slice(0, limit);

  setCache(cacheKey, limitedResults, searchCache);
  return limitedResults;
}

function deduplicateResults(results) {
  const seen = new Map();
  for (const r of results) {
    const key = r.id || `${r.title}:${r.year}`;
    if (!seen.has(key)) seen.set(key, r);
  }
  return Array.from(seen.values());
}

// ─── Stream Details ──────────────────────────────────────────────────────────────

async function streamDetails(id, type = 'movie', opts = {}) {
  const {
    addons = DEFAULT_ADDONS,
    timeout = ADDON_TIMEOUT_MS,
    skipErrors = true,
  } = opts;

  const cacheKey = `stream:${type}:${id}`;
  const cached = getCached(cacheKey, searchCache, CACHE_TTL_MS);
  if (cached) return cached;

  const streams = [];
  const enabledAddons = addons.filter((a) => a.enabled !== false);

  await Promise.allSettled(
    enabledAddons.map(async (addon) => {
      try {
        const manifest = await getAddonManifest(addon.url, { timeout });
        if (!manifest) return;

        const hasStreams = (manifest.resources || []).some(
          (r) => (typeof r === 'string' ? r : r.name) === 'stream'
        );
        if (!hasStreams) return;

        try {
          const streamUrl = addon.url.replace(
            '/manifest.json',
            `/stream/${type}/${id}.json`
          );
          const data = await fetchJSON(streamUrl, { timeout });
          const addonStreams = data.streams || [];

          for (const stream of addonStreams) {
            streams.push({
              // OmniScraper unified format
              id: `${addon.name}:${stream.url || stream.infoHash || 'unknown'}`,
              title: stream.title || `${addon.name} Stream`,
              url: stream.url || null,
              infoHash: stream.infoHash || null,
              fileIdx: stream.fileIdx || null,
              // Stream details
              addon: addon.name,
              addonUrl: addon.url,
              type: stream.type || 'unknown',
              quality: stream.quality || null,
              codec: stream.codec || null,
              size: stream.size || null,
              fps: stream.fps || null,
              // Behavior hints
              behaviorHints: stream.behaviorHints || {},
              // Compatibility
              source: 'stremio',
              sourceType: 'stream',
              mediaId: id,
              mediaType: type,
            });
          }
        } catch (err) {
          if (!skipErrors) throw err;
          console.error(
            `[stremio-plugin] Stream details failed [${addon.name}]:`,
            err.message
          );
        }
      } catch (err) {
        if (!skipErrors) throw err;
        console.error(`[stremio-plugin] Addon error [${addon.name}]:`, err.message);
      }
    })
  );

  const result = {
    id,
    type,
    streams,
    totalStreams: streams.length,
    addonsQueried: enabledAddons.length,
    timestamp: Date.now(),
  };

  setCache(cacheKey, result, searchCache);
  return result;
}

// ─── Meta Details ────────────────────────────────────────────────────────────────

async function getMetaDetails(id, type = 'movie', opts = {}) {
  const cacheKey = `meta:${type}:${id}`;
  const cached = getCached(cacheKey, searchCache, CACHE_TTL_MS);
  if (cached) return cached;

  const enabledAddons = (opts.addons || DEFAULT_ADDONS).filter((a) => a.enabled !== false);

  for (const addon of enabledAddons) {
    try {
      const manifest = await getAddonManifest(addon.url, opts);
      if (!manifest) continue;

      const hasMeta = (manifest.resources || []).some(
        (r) => (typeof r === 'string' ? r : r.name) === 'meta'
      );
      if (!hasMeta) continue;

      try {
        const metaUrl = addon.url.replace(
          '/manifest.json',
          `/meta/${type}/${id}.json`
        );
        const data = await fetchJSON(metaUrl, opts);
        if (data.meta) {
          const result = {
            ...data.meta,
            addon: addon.name,
            source: 'stremio',
            sourceType: 'streaming',
          };
          setCache(cacheKey, result, searchCache);
          return result;
        }
      } catch (err) {
        console.error(`[stremio-plugin] Meta fetch failed [${addon.name}]:`, err.message);
      }
    } catch (err) {
      console.error(`[stremio-plugin] Addon error [${addon.name}]:`, err.message);
    }
  }

  return null;
}

// ─── Subtitles ───────────────────────────────────────────────────────────────────

async function getSubtitles(id, type = 'movie', opts = {}) {
  const enabledAddons = (opts.addons || DEFAULT_ADDONS).filter(
    (a) => a.enabled !== false && a.name.toLowerCase().includes('subtitle')
  );

  const subtitles = [];
  await Promise.allSettled(
    enabledAddons.map(async (addon) => {
      try {
        const manifest = await getAddonManifest(addon.url, opts);
        if (!manifest) return;

        const subUrl = addon.url.replace(
          '/manifest.json',
          `/subtitles/${type}/${id}.json`
        );
        const data = await fetchJSON(subUrl, opts);
        (data.subtitles || []).forEach((s) =>
          subtitles.push({ ...s, addon: addon.name })
        );
      } catch (err) {
        console.error(`[stremio-plugin] Subtitles failed [${addon.name}]:`, err.message);
      }
    })
  );

  return subtitles;
}

// ─── Plugin Registration (OmniScraper Compatible) ───────────────────────────────

const plugin = {
  name: 'stremio',
  version: '1.0.0',
  description: 'Stremio addon integration for OmniScraper',

  // Core methods
  searchCatalog,
  streamDetails,
  getAddonManifest,
  getMetaDetails,
  getSubtitles,

  // OmniScraper search interface
  async search(query, opts = {}) {
    const type = opts.mediaType || opts.type || null;
    const results = await searchCatalog(query, type, opts);
    return {
      query,
      type,
      results,
      total: results.length,
      source: 'stremio',
      timestamp: Date.now(),
    };
  },

  async details(id, type = 'movie', opts = {}) {
    const [meta, streams] = await Promise.allSettled([
      getMetaDetails(id, type, opts),
      streamDetails(id, type, opts),
    ]);
    return {
      id,
      type,
      meta: meta.status === 'fulfilled' ? meta.value : null,
      streams: streams.status === 'fulfilled' ? streams.value.streams : [],
      source: 'stremio',
      timestamp: Date.now(),
    };
  },

  // Cache management
  clearCache() {
    manifestCache.clear();
    searchCache.clear();
  },

  getCacheStats() {
    return {
      manifestCache: manifestCache.size,
      searchCache: searchCache.size,
    };
  },

  // Addon management
  getAddons() {
    return DEFAULT_ADDONS.map((a) => ({ ...a }));
  },

  enableAddon(name) {
    const addon = DEFAULT_ADDONS.find((a) => a.name === name);
    if (addon) addon.enabled = true;
  },

  disableAddon(name) {
    const addon = DEFAULT_ADDONS.find((a) => a.name === name);
    if (addon) addon.enabled = false;
  },
};

module.exports = plugin;
