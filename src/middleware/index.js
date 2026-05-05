import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import crypto from 'node:crypto';
import config from '../config/index.js';
import { AuthError, ValidationError, TimeoutError } from '../errors/index.js';

const ajv = new Ajv({ allErrors: true, removeAdditional: 'all' });
addFormats(ajv);

export function authMiddleware(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (!apiKey || apiKey !== config.apiKey) {
    throw new AuthError('Invalid or missing API key');
  }
  next();
}

export function requestLogger(logger) {
  return (req, res, next) => {
    const requestId = req.headers['x-request-id'] || crypto.randomUUID();
    req.requestId = requestId;
    res.setHeader('X-Request-ID', requestId);
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.info({
        request_id: requestId,
        method: req.method,
        url: req.url,
        status: res.statusCode,
        duration_ms: duration,
        user_agent: req.headers['user-agent'],
        ip: req.ip
      }, 'request completed');
    });
    next();
  };
}

export function errorHandler(logger) {
  return (err, req, res, _next) => {
    const requestId = req.requestId || 'unknown';
    const statusCode = err.statusCode || 500;
    const errorCode = err.errorCode || 'INTERNAL_ERROR';

    logger.error({
      request_id: requestId,
      error: err.message,
      code: errorCode,
      stack: err.stack,
      url: req.url,
      method: req.method
    }, 'request error');

    res.status(statusCode).json({
      error: {
        message: err.isOperational ? err.message : 'Internal server error',
        code: errorCode,
        request_id: requestId
      }
    });
  };
}

export function timeoutMiddleware(ms = config.timeouts.default) {
  return (req, res, next) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        next(new TimeoutError(`Request timeout after ${ms}ms`));
      }
    }, ms);
    res.on('finish', () => clearTimeout(timer));
    res.on('close', () => clearTimeout(timer));
    next();
  };
}

export function rateLimitMiddleware(options = {}) {
  const { windowMs = 60 * 1000, max = 100 } = options;
  const requests = new Map();

  return (req, res, next) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    const windowStart = now - windowMs;

    if (!requests.has(key)) requests.set(key, []);
    const timestamps = requests.get(key).filter(t => t > windowStart);

    if (timestamps.length >= max) {
      return next(new RateLimitError());
    }

    timestamps.push(now);
    requests.set(key, timestamps);
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - timestamps.length));
    next();
  };
}

export function validationMiddleware(schema) {
  const validate = ajv.compile(schema);
  return (req, res, next) => {
    const valid = validate(req.body);
    if (!valid) {
      const details = validate.errors.map(e => ({
        field: e.instancePath || e.schemaPath,
        message: e.message
      }));
      throw new ValidationError('Request validation failed', details);
    }
    next();
  };
}
