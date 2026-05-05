import { strict as assert } from 'node:assert';
import { config as loadEnv } from 'dotenv';
import process from 'node:process';

loadEnv();

const requiredEnvVars = ['API_KEY'];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`FATAL: Missing required environment variable: ${envVar}`);
  }
}

const config = Object.freeze({
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  apiKey: process.env.API_KEY,
  puppeteerArgs: (process.env.PUPPETEER_ARGS || '--no-sandbox --disable-setuid-sandbox').split(' '),
  proxyList: process.env.PROXY_LIST ? process.env.PROXY_LIST.split(',') : [],
  redisUrl: process.env.REDIS_URL || '',
  dbUrl: process.env.DB_URL || '',

  rateLimits: {
    free: { windowMs: 60 * 1000, max: 30 },
    basic: { windowMs: 60 * 1000, max: 100 },
    pro: { windowMs: 60 * 1000, max: 500 },
    enterprise: { windowMs: 60 * 1000, max: 5000 }
  },

  featureFlags: {
    enableTorrent: process.env.ENABLE_TORRENT !== 'false',
    enableMusic: process.env.ENABLE_MUSIC !== 'false',
    enableScraping: process.env.ENABLE_SCRAPING !== 'false',
    enableRSS: process.env.ENABLE_RSS !== 'false',
    enableSSE: process.env.ENABLE_SSE !== 'false',
    enablePluginHotReload: process.env.ENABLE_HOT_RELOAD === 'true'
  },

  timeouts: {
    default: parseInt(process.env.DEFAULT_TIMEOUT || '30000', 10),
    scraping: parseInt(process.env.SCRAPING_TIMEOUT || '60000', 10),
    torrent: parseInt(process.env.TORRENT_TIMEOUT || '120000', 10),
    music: parseInt(process.env.MUSIC_TIMEOUT || '15000', 10)
  },

  cache: {
    ttl: { default: 300000, scrape: 300000, movie: 300000, torrent: 600000, music: 180000 },
    maxSize: 10000
  },

  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID']
  },

  log: {
    level: process.env.LOG_LEVEL || 'info',
    retentionDays: 30,
    maxFileSize: '20m'
  }
});

assert(config.port > 0 && config.port < 65536, 'PORT must be a valid port number');
assert(['development', 'production', 'test'].includes(config.env), 'NODE_ENV must be development, production, or test');

export default config;
