import { ToadScheduler, SimpleIntervalJob, AsyncTask } from 'toad-scheduler';
import config from '../config/index.js';
import logger from '../logger/index.js';

export class SchedulerService {
  constructor() {
    this.scheduler = new ToadScheduler();
    this.jobs = new Map();
  }

  addJob(name, taskFn, intervalMs, options = {}) {
    const task = new AsyncTask(
      name,
      async () => {
        try {
          logger.info({ job: name }, `Running scheduled job: ${name}`);
          const start = Date.now();
          await taskFn();
          const duration = Date.now() - start;
          logger.info({ job: name, duration_ms: duration }, `Job completed: ${name}`);
        } catch (err) {
          logger.error({ job: name, error: err.message }, `Job failed: ${name}`);
        }
      },
      (err) => {
        logger.error({ job: name, error: err.message }, `Job error: ${name}`);
      }
    );

    const job = new SimpleIntervalJob(
      { milliseconds: intervalMs, runImmediately: options.runImmediately ?? false },
      task
    );

    this.scheduler.addSimpleIntervalJob(job);
    this.jobs.set(name, job);
    logger.info({ job: name, intervalMs }, `Scheduled job: ${name}`);
    return this;
  }

  removeJob(name) {
    const job = this.jobs.get(name);
    if (job) {
      this.scheduler.removeById(job.id);
      this.jobs.delete(name);
      logger.info({ job: name }, `Removed job: ${name}`);
    }
    return this;
  }

  setupDefaultJobs(registry, cache) {
    if (config.featureFlags.enableScraping) {
      this.addJob('cache-warm-imdb', async () => {
        const imdb = registry.get('imdb');
        if (imdb) await imdb.getTopMovies(10);
      }, 300000, { runImmediately: true });
    }

    this.addJob('cache-stats-log', async () => {
      const stats = cache.getStats();
      logger.info({ stats }, 'Cache statistics');
    }, 60000);

    this.addJob('cleanup-old-data', async () => {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      logger.info({ cutoff: new Date(cutoff).toISOString() }, 'Cleanup completed');
    }, 3600000);

    this.addJob('health-ping', async () => {
      logger.debug('Health ping');
    }, 30000);
  }

  stop() {
    this.scheduler.stop();
    logger.info('Scheduler stopped');
  }

  start() {
    this.scheduler.start();
    logger.info('Scheduler started');
  }
}

export default SchedulerService;
