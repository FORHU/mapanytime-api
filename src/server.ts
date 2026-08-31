import dotenv from 'dotenv';
dotenv.config();

import http from 'http';
import app from './app';
import logger from './utils/logger';
import { PORT, NODE_ENV, assertCheckoutReturnUrl } from './config';
import { prisma } from './utils/prisma';
import { redis } from './infrastructure/redis';
import { rabbitmq } from './infrastructure/rabbitmq';
import { initSocket } from './infrastructure/socket';
import RedisUtil from './utils/redis.util';

const server = http.createServer(app);

// Realtime store updates (region-scoped rooms) share the HTTP server.
initSocket(server);

// Wrap the server startup in an async function to await infrastructure initialization
const startServer = async () => {
  try {
    // Fails the boot in production, warns in development. A bad FRONTEND_URL
    // is invisible until a buyer presses Pay, so it is worth one check here.
    assertCheckoutReturnUrl();

    // Initialize infrastructure before opening the port to traffic
    await RedisUtil.initialize();
    await rabbitmq.connect();

    // Explicit 0.0.0.0: this runs in a container (see Dockerfile), and the
    // published port is only reachable if the server binds every interface.
    server.listen(Number(PORT), '0.0.0.0', () => {
      logger.info(`Server running on port ${PORT} in ${NODE_ENV} mode`);
    });
  } catch (error) {
    logger.error('Failed to initialize critical infrastructure:', error);
    process.exit(1);
  }
};

startServer();

const gracefulShutdown = async (signal: string) => {
  logger.info(`[Shutdown] ${signal} received. Starting graceful shutdown...`);

  // Stop accepting new connections
  server.close(async (err) => {
    if (err) {
      logger.error('[Shutdown] Error closing HTTP server:', err);
      process.exit(1);
    }

    try {
      // Disconnect from all infrastructure
      await rabbitmq.close();
      await redis.close();
      await prisma.$disconnect();

      // Also close the utility client gracefully
      if (RedisUtil.client?.isOpen) {
        await RedisUtil.client.disconnect();
      }

      logger.info('[Shutdown] All connections closed. Goodbye.');
      process.exit(0);
    } catch (shutdownError) {
      logger.error('[Shutdown] Error during cleanup:', shutdownError);
      process.exit(1);
    }
  });

  // Force exit if graceful shutdown takes too long
  setTimeout(() => {
    logger.error('[Shutdown] Graceful shutdown timed out. Forcing exit.');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('[Process] Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('[Process] Uncaught Exception:', error);
  process.exit(1);
});
