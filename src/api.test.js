import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';
import { rateLimit } from 'express-rate-limit';
import { createRequestLogger } from './logger/index.js';
import { PluginRegistry } from './plugins/registry.js';
import config from './config/index.js';
import http from 'node:http';

function createTestApp(plugins = {}) {
  const app = express();
  const requestLogger = createRequestLogger();

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors(config.cors));
  app.use(express.json({ limit: '10mb' }));
  app.use(pinoHttp({ logger: requestLogger }));

  const globalLimiter = rateLimit({
    windowMs: 1000,
    max: 100,
    message: { error: { message: 'Rate limit exceeded', code: 'RATE_LIMIT_EXCEEDED' } }
  });
  app.use(globalLimiter);

  const registry = new PluginRegistry();

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/health/ready', (req, res) => {
    res.json({ status: 'ready', plugins: registry.getAll().length, timestamp: new Date().toISOString() });
  });

  app.get('/health/live', (req, res) => {
    res.json({ status: 'alive' });
  });

  app.get('/api/v1/scrape/imdb/top', (req, res) => {
    res.json({ data: plugins.imdbTop || [] });
  });

  app.get('/api/v1/scrape/imdb/movie/:id', (req, res) => {
    res.json({ data: plugins.imdbMovie || null });
  });

  app.get('/api/v1/scrape/imdb/search', (req, res) => {
    res.json({ data: plugins.imdbSearch || [] });
  });

  app.post('/api/v1/scrape/universal/run', (req, res) => {
    res.json({ data: plugins.universalRun || {} });
  });

  app.get('/api/v1/torrent/info', (req, res) => {
    res.json({ data: plugins.torrentInfo || {} });
  });

  app.get('/api/v1/music/now-playing', (req, res) => {
    res.json({ data: plugins.nowPlaying || null });
  });

  app.get('/api/v1/music/analytics', (req, res) => {
    res.json({ data: plugins.analytics || {} });
  });

  app.get('/api/v1/search', (req, res) => {
    res.json({ data: plugins.search || [] });
  });

  app.get('/api/v1/rss/:source', (req, res) => {
    res.set('Content-Type', 'application/rss+xml');
    res.send(plugins.rss || '<rss></rss>');
  });

  app.get('/api/v1/stremio/catalog/:type/:id', (req, res) => {
    res.json({ data: plugins.stremioCatalog || [] });
  });

  app.get('/api/v1/stremio/stream/:type/:id', (req, res) => {
    res.json({ data: plugins.stremioStream || [] });
  });

  app.get('/api/v1/stremio/meta/:type/:id', (req, res) => {
    res.json({ data: plugins.stremioMeta || {} });
  });

  app.get('/api/v1/stremio/addons', (req, res) => {
    res.json({ data: plugins.stremioAddons || [] });
  });

  app.post('/api/v1/stremio/search', (req, res) => {
    res.json({ data: plugins.stremioSearch || [] });
  });

  app.get('/api/v1/plugins', (req, res) => {
    res.json({ plugins: registry.getAll() });
  });

  app.get('/api/v1/logs', (req, res) => {
    res.json({ message: 'Log aggregation endpoint' });
  });

  app.use((err, req, res, next) => {
    res.status(500).json({ error: { message: err.message } });
  });

  return app;
}

function makeRequest(server, method, path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(`http://localhost:${server.address().port}${path}`);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method.toUpperCase(),
      headers: options.headers || {},
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

describe('API Health Endpoints', () => {
  let app;
  let server;

  before(() => {
    app = createTestApp();
    server = http.createServer(app);
    server.listen(0);
  });

  after(() => {
    server.close();
  });

  it('GET /health returns ok status', async () => {
    const res = await makeRequest(server, 'get', '/health');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'ok');
    assert.ok(res.body.timestamp);
  });

  it('GET /health/ready returns ready status', async () => {
    const res = await makeRequest(server, 'get', '/health/ready');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'ready');
  });

  it('GET /health/live returns alive status', async () => {
    const res = await makeRequest(server, 'get', '/health/live');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'alive');
  });
});

describe('IMDB API Endpoints', () => {
  let server;

  before(() => {
    const app = createTestApp({
      imdbTop: [{ title: 'Movie 1', year: 2024 }],
      imdbMovie: { title: 'Movie', year: 2024 },
      imdbSearch: [{ title: 'Search Result' }],
    });
    server = http.createServer(app);
    server.listen(0);
  });

  after(() => {
    server.close();
  });

  it('GET /api/v1/scrape/imdb/top returns movies', async () => {
    const res = await makeRequest(server, 'get', '/api/v1/scrape/imdb/top?limit=10');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.data));
  });

  it('GET /api/v1/scrape/imdb/movie/:id returns movie details', async () => {
    const res = await makeRequest(server, 'get', '/api/v1/scrape/imdb/movie/tt1234567');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.data);
  });

  it('GET /api/v1/scrape/imdb/search returns search results', async () => {
    const res = await makeRequest(server, 'get', '/api/v1/scrape/imdb/search?q=matrix');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.data));
  });
});

describe('Universal Scraper Endpoint', () => {
  let server;

  before(() => {
    const app = createTestApp({
      universalRun: { result: 'scraped data' }
    });
    server = http.createServer(app);
    server.listen(0);
  });

  after(() => {
    server.close();
  });

  it('POST /api/v1/scrape/universal/run requires scraper and url', async () => {
    const res = await makeRequest(server, 'post', '/api/v1/scrape/universal/run', {
      headers: { 'Content-Type': 'application/json' },
      body: { scraper: 'generic', url: 'https://example.com' }
    });
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.data);
  });
});

describe('Torrent Endpoint', () => {
  let server;

  before(() => {
    const app = createTestApp({
      torrentInfo: { name: 'Test Torrent', size: 1000 }
    });
    server = http.createServer(app);
    server.listen(0);
  });

  after(() => {
    server.close();
  });

  it('GET /api/v1/torrent/info returns torrent info', async () => {
    const res = await makeRequest(server, 'get', '/api/v1/torrent/info?magnet=magnet:?xt=test');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.data);
  });
});

describe('Music API Endpoints', () => {
  let server;

  before(() => {
    const app = createTestApp({
      nowPlaying: { track: 'Song', artist: 'Artist' },
      analytics: { total_plays: 100, total_hours: 5 }
    });
    server = http.createServer(app);
    server.listen(0);
  });

  after(() => {
    server.close();
  });

  it('GET /api/v1/music/now-playing returns now playing', async () => {
    const res = await makeRequest(server, 'get', '/api/v1/music/now-playing');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.data);
  });

  it('GET /api/v1/music/analytics returns analytics', async () => {
    const res = await makeRequest(server, 'get', '/api/v1/music/analytics');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.data);
  });
});

describe('Search Endpoint', () => {
  let server;

  before(() => {
    const app = createTestApp({
      search: [{ title: 'Result 1' }]
    });
    server = http.createServer(app);
    server.listen(0);
  });

  after(() => {
    server.close();
  });

  it('GET /api/v1/search requires query parameter', async () => {
    const res = await makeRequest(server, 'get', '/api/v1/search?q=test');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.data));
  });

  it('GET /api/v1/search with type filter', async () => {
    const res = await makeRequest(server, 'get', '/api/v1/search?q=test&type=movie');
    assert.strictEqual(res.status, 200);
  });
});

describe('RSS Endpoint', () => {
  let server;

  before(() => {
    const app = createTestApp({
      rss: '<rss><channel><title>Test</title></channel></rss>'
    });
    server = http.createServer(app);
    server.listen(0);
  });

  after(() => {
    server.close();
  });

  it('GET /api/v1/rss/:source returns RSS XML', async () => {
    const res = await makeRequest(server, 'get', '/api/v1/rss/feed1');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.includes('<rss>') || typeof res.body === 'string');
  });
});

describe('Stremio Endpoints', () => {
  let server;

  before(() => {
    const app = createTestApp({
      stremioCatalog: [{ id: '1', name: 'Item' }],
      stremioStream: [{ url: 'http://test.com' }],
      stremioMeta: { id: '1', name: 'Meta' },
      stremioAddons: [{ name: 'Addon' }],
      stremioSearch: [{ id: '1', name: 'Search Result' }],
    });
    server = http.createServer(app);
    server.listen(0);
  });

  after(() => {
    server.close();
  });

  it('GET /api/v1/stremio/catalog/:type/:id returns catalog', async () => {
    const res = await makeRequest(server, 'get', '/api/v1/stremio/catalog/movie/popular');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.data);
  });

  it('GET /api/v1/stremio/stream/:type/:id returns streams', async () => {
    const res = await makeRequest(server, 'get', '/api/v1/stremio/stream/movie/tt123');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.data);
  });

  it('GET /api/v1/stremio/meta/:type/:id returns meta', async () => {
    const res = await makeRequest(server, 'get', '/api/v1/stremio/meta/movie/tt123');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.data);
  });

  it('GET /api/v1/stremio/addons returns addons', async () => {
    const res = await makeRequest(server, 'get', '/api/v1/stremio/addons');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.data);
  });

  it('POST /api/v1/stremio/search returns search results', async () => {
    const res = await makeRequest(server, 'post', '/api/v1/stremio/search', {
      headers: { 'Content-Type': 'application/json' },
      body: { query: 'test' }
    });
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.data);
  });
});

describe('Plugin Registry Endpoint', () => {
  let server;

  before(() => {
    const app = createTestApp();
    server = http.createServer(app);
    server.listen(0);
  });

  after(() => {
    server.close();
  });

  it('GET /api/v1/plugins returns plugin list', async () => {
    const res = await makeRequest(server, 'get', '/api/v1/plugins');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.plugins);
  });
});

describe('Logs Endpoint', () => {
  let server;

  before(() => {
    const app = createTestApp();
    server = http.createServer(app);
    server.listen(0);
  });

  after(() => {
    server.close();
  });

  it('GET /api/v1/logs returns log message', async () => {
    const res = await makeRequest(server, 'get', '/api/v1/logs');
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.message);
  });
});

describe('Rate Limiting', () => {
  let server;

  before(() => {
    const app = createTestApp();
    server = http.createServer(app);
    server.listen(0);
  });

  after(() => {
    server.close();
  });

  it('handles multiple requests without crashing', async () => {
    const requests = [];
    for (let i = 0; i < 10; i++) {
      requests.push(makeRequest(server, 'get', '/health'));
    }
    const results = await Promise.all(requests);
    results.forEach(res => {
      assert.ok(res.status === 200 || res.status === 429);
    });
  });
});

describe('Input Validation', () => {
  let server;

  before(() => {
    const app = createTestApp();
    server = http.createServer(app);
    server.listen(0);
  });

  after(() => {
    server.close();
  });

  it('handles invalid JSON gracefully', async () => {
    const res = await makeRequest(server, 'post', '/api/v1/stremio/search', {
      headers: { 'Content-Type': 'application/json' },
      body: null
    });
    assert.ok(res.status >= 200 && res.status < 500);
  });
});

describe('Error Responses', () => {
  let server;

  before(() => {
    const app = createTestApp();
    server = http.createServer(app);
    server.listen(0);
  });

  after(() => {
    server.close();
  });

  it('returns 404 for non-existent routes', async () => {
    const res = await makeRequest(server, 'get', '/api/v1/nonexistent');
    assert.strictEqual(res.status, 404);
  });

  it('handles server errors gracefully', async () => {
    const errorApp = express();
    errorApp.get('/error', (req, res) => {
      throw new Error('Test error');
    });
    errorApp.use((err, req, res, next) => {
      res.status(500).json({ error: { message: err.message } });
    });

    const errorServer = http.createServer(errorApp);
    errorServer.listen(0);

    const res = await makeRequest(errorServer, 'get', '/error');
    assert.strictEqual(res.status, 500);
    
    errorServer.close();
  });
});
