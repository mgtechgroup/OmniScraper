import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';
import { rateLimit } from 'express-rate-limit';
import config from './config/index.js';
import { authMiddleware, requestLogger, errorHandler, timeoutMiddleware, rateLimitMiddleware } from './middleware/index.js';
import logger, { createRequestLogger } from './logger/index.js';
import { PluginRegistry } from './plugins/registry.js';
import IMDBPlugin from './plugins/imdb.js';
import UniversalPlugin from './plugins/universal.js';
import TorrentPlugin from './plugins/torrent.js';
import MusicPlugin from './plugins/music.js';
import SearchPlugin from './plugins/search.js';
import RSSPlugin from './plugins/rss.js';
import CacheService from './services/cache.js';
import SchedulerService from './services/scheduler.js';
import { AppError, ScrapingError, RateLimitError, AuthError, ValidationError, NotFoundError, ServiceUnavailableError, TimeoutError, CircuitBreakerError } from './errors/index.js';

const app = express();
const requestLoggerInstance = createRequestLogger();

app.use(helmet({ contentSecurityPolicy: config.env === 'production' }));
app.use(cors(config.cors));
app.use(express.json({ limit: '10mb' }));
app.use(pinoHttp({ logger: requestLoggerInstance }));
app.use(requestLogger(logger));

const globalLimiter = rateLimit({
  windowMs: config.rateLimits.free.windowMs,
  max: config.rateLimits.free.max,
  message: { error: { message: 'Rate limit exceeded', code: 'RATE_LIMIT_EXCEEDED' } }
});
app.use(globalLimiter);

const registry = new PluginRegistry();
const cache = new CacheService();
const scheduler = new SchedulerService();

let sseClients = new Set();

async function initializePlugins() {
  await cache.init();

  const imdb = new IMDBPlugin();
  await imdb.init();
  registry.register(imdb.manifest, imdb);
  await registry.start('imdb');

  const universal = new UniversalPlugin();
  await universal.init();
  registry.register(universal.manifest, universal);
  await registry.start('universal');

  if (config.featureFlags.enableTorrent) {
    const torrent = new TorrentPlugin();
    await torrent.init();
    registry.register(torrent.manifest, torrent);
    await registry.start('torrent');
  }

  if (config.featureFlags.enableMusic) {
    const music = new MusicPlugin();
    await music.init();
    registry.register(music.manifest, music);
    await registry.start('music');

    music.on('sse:event', (event) => {
      for (const client of sseClients) {
        try { client.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`); } catch (_) {}
      }
    });
  }

  const search = new SearchPlugin(registry);
  registry.register(search.manifest, search);
  await registry.start('search');

  if (config.featureFlags.enableRSS) {
    const rss = new RSSPlugin(registry);
    registry.register(rss.manifest, rss);
    await registry.start('rss');
  }

  scheduler.setupDefaultJobs(registry, cache);
}

app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
app.get('/health/ready', (_req, res) => {
  const plugins = registry.getAll();
  res.json({ status: 'ready', plugins: plugins.length, timestamp: new Date().toISOString() });
});
app.get('/health/live', (_req, res) => res.json({ status: 'alive' }));

app.get('/api/v1/scrape/imdb/top', authMiddleware, timeoutMiddleware(config.timeouts.scraping), async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const data = await registry.get('imdb').getTopMovies(limit);
    res.json({ data });
  } catch (err) { next(err); }
});

app.get('/api/v1/scrape/imdb/movie/:id', authMiddleware, timeoutMiddleware(config.timeouts.scraping), async (req, res, next) => {
  try {
    const data = await registry.get('imdb').getMovieDetails(req.params.id);
    res.json({ data });
  } catch (err) { next(err); }
});

app.get('/api/v1/scrape/imdb/search', authMiddleware, timeoutMiddleware(config.timeouts.scraping), async (req, res, next) => {
  try {
    const query = req.query.q;
    if (!query) throw new ValidationError('Query parameter q is required');
    const data = await registry.get('imdb').searchMovies(query);
    res.json({ data });
  } catch (err) { next(err); }
});

app.post('/api/v1/scrape/universal/run', authMiddleware, timeoutMiddleware(config.timeouts.scraping), async (req, res, next) => {
  try {
    const { scraper, url } = req.body;
    const data = await registry.get('universal').runScraper(scraper, url);
    res.json({ data });
  } catch (err) { next(err); }
});

app.get('/api/v1/torrent/info', authMiddleware, timeoutMiddleware(config.timeouts.torrent), async (req, res, next) => {
  try {
    const { magnet } = req.query;
    const data = await registry.get('torrent').getTorrentInfo(magnet);
    res.json({ data });
  } catch (err) { next(err); }
});

app.get('/api/v1/music/now-playing', authMiddleware, async (req, res, next) => {
  try {
    const data = await registry.get('music').getSpotifyNowPlaying();
    res.json({ data });
  } catch (err) { next(err); }
});

app.get('/api/v1/music/analytics', authMiddleware, async (req, res, next) => {
  try {
    const data = registry.get('music').getListeningAnalytics();
    res.json({ data });
  } catch (err) { next(err); }
});

app.get('/api/v1/search', authMiddleware, async (req, res, next) => {
  try {
    const { q, type, limit, offset } = req.query;
    const data = await registry.get('search').search(q, { type, limit: parseInt(limit) || 50, offset: parseInt(offset) || 0 });
    res.json({ data });
  } catch (err) { next(err); }
});

app.get('/api/v1/rss/:source', authMiddleware, async (req, res, next) => {
  try {
    const xml = await registry.get('rss').getFeed(req.params.source, req.params.category);
    res.set('Content-Type', 'application/rss+xml');
    res.send(xml);
  } catch (err) { next(err); }
});

app.get('/api/v1/events', authMiddleware, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

app.get('/api/v1/plugins', authMiddleware, (_req, res) => {
  res.json({ plugins: registry.getAll() });
});

app.get('/api/v1/logs', authMiddleware, (_req, res) => {
  res.json({ message: 'Log aggregation endpoint - check log files in /logs directory' });
});

app.use(errorHandler(logger));

const server = app.listen(config.port, () => {
  logger.info({ port: config.port, env: config.env }, `OmniScraper server started`);
});

const signals = ['SIGTERM', 'SIGINT'];
for (const signal of signals) {
  process.on(signal, async () => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    server.close(() => logger.info('HTTP server closed'));
    await registry.stopAll();
    scheduler.stop();
    process.exit(0);
  });
}

process.on('uncaughtException', (err) => {
  logger.fatal({ error: err.message, stack: err.stack }, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled rejection');
  process.exit(1);
});

initializePlugins().catch((err) => {
  logger.fatal({ error: err.message }, 'Failed to initialize plugins');
  process.exit(1);
});

export default app;
