import pino from 'pino';
import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import config from '../config/index.js';

const logDir = path.resolve('logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

const redactPaths = [
  '*.password', '*.token', '*.apiKey', '*.api_key', '*.secret', '*.credit_card',
  '*.authorization', '*.Authorization', '*.accessToken', '*.refreshToken',
  'headers.authorization', 'headers.Authorization', 'body.password', 'body.token'
];

const transport = pino.transport({
  targets: [
    {
      level: config.log.level,
      target: 'pino/file',
      options: {
        destination: path.join(logDir, `omniscraper-${new Date().toISOString().split('T')[0]}.log`),
        mkdir: true
      }
    },
    ...(config.env !== 'production' ? [{
      level: 'info',
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname' }
    }] : [])
  ]
});

const logger = pino({
  level: config.log.level,
  redact: { paths: redactPaths, censor: '***REDACTED***' },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
    bindings: (bindings) => ({ pid: bindings.pid, hostname: bindings.hostname })
  },
  base: { service: 'omniscraper', env: config.env }
}, transport);

export function createRequestLogger() {
  return {
    ...logger,
    child: (bindings) => logger.child(bindings)
  };
}

export function withRequestId(req) {
  return logger.child({ request_id: req.requestId || crypto.randomUUID() });
}

export function logPerformance(operation, startTime, meta = {}) {
  const duration = Date.now() - startTime;
  logger.info({ operation, duration_ms: duration, ...meta }, `performance: ${operation}`);
}

export function logError(err, meta = {}) {
  logger.error({
    error: err.message,
    code: err.errorCode || 'UNKNOWN',
    stack: err.stack,
    ...meta
  }, err.message);
}

export default logger;
