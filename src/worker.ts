import dotenv from 'dotenv';
dotenv.config();

import os from 'os';
import http from 'http';
import { rabbitmq } from './infrastructure/rabbitmq';
import { redis } from './infrastructure/redis';
import { startEmailConsumer } from './consumers/email.consumer';
import { startAiConsumer } from './consumers/ai.consumer';
import { workerMetrics } from './utils/worker-metrics';
import { startScheduler } from './infrastructure/scheduler';
import logger from './utils/logger';

const WORKER_HEALTH_PORT = Number(process.env.WORKER_HEALTH_PORT || 8080);
const cpuCount = os.cpus().length;

// Track readiness state — 503 until all consumers are up
let isReady = false;

/**
 * Lightweight health HTTP server — runs on a separate port from the API.
 * Kubernetes/ECS probes this independently to manage worker lifecycle.
 *
 * GET /health → 503 while starting, 200 with metrics snapshot when ready
 * GET /live   → always 200 (process is alive)
 */
const healthServer = http.createServer((req, res) => {
  if (req.url === '/live') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: Math.floor(process.uptime()) }));
    return;
  }

  if (req.url === '/health' || req.url === '/ready') {
    if (isReady) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(workerMetrics.getSnapshot()));
    } else {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'starting' }));
    }
    return;
  }

  res.writeHead(404);
  res.end();
});

const startWorker = async () => {
  logger.info(
    `[Worker] Starting on ${os.hostname()} (${cpuCount} CPUs, ${Math.round(os.totalmem() / 1024 / 1024)}MB RAM)`,
  );

  if (cpuCount <= 1) {
    logger.warn(`[Worker] Only ${cpuCount} CPU core(s) available — consider scaling.`);
  }

  // Connect to all infrastructure
  await rabbitmq.connect();
  await redis.connect();

  // Register all consumers
  await startEmailConsumer();
  await startAiConsumer();

  // Start scheduled jobs (cron)
  startScheduler();

  // Mark as ready — health server will now return 200
  isReady = true;

  // Start health server
  healthServer.listen(WORKER_HEALTH_PORT, () => {
    logger.info(`[Worker] Health endpoint: http://localhost:${WORKER_HEALTH_PORT}/health`);
  });

  // Start periodic metric logging + Redis persistence
  workerMetrics.startPeriodicLogging();

  logger.info('[Worker] All consumers ready. Listening for events.');
};

const gracefulShutdown = async (signal: string) => {
  logger.info(`[Worker][Shutdown] ${signal} received. Starting graceful shutdown...`);

  isReady = false;
  workerMetrics.stop();
  healthServer.close();

  try {
    await rabbitmq.close();
    await redis.close();

    logger.info('[Worker][Shutdown] All connections closed. Goodbye.');
    process.exit(0);
  } catch (err) {
    logger.error('[Worker][Shutdown] Error during cleanup:', err);
    process.exit(1);
  }
};

startWorker().catch((err) => {
  logger.error('[Worker] Fatal startup error:', err);
  process.exit(1);
});

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('[Worker] Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('[Worker] Uncaught Exception:', error);
  process.exit(1);
});
