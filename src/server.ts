import dotenv from 'dotenv';
dotenv.config();

import http from 'http';
import app from './app';
import logger from './utils/logger';
import { PORT, NODE_ENV } from './config';
import { prisma } from './utils/prisma';
import { redis } from './infrastructure/redis';
import { initSocket } from './infrastructure/socket';

const server = http.createServer(app);

// Realtime store updates (region-scoped rooms) share the HTTP server.
initSocket(server);

server.listen(Number(PORT), '0.0.0.0', () => {
  logger.info(`Server running on port ${PORT} in ${NODE_ENV} mode`);
});

const gracefulShutdown = async (signal: string) => {
  logger.info(`[Shutdown] ${signal} received. Starting graceful shutdown...`);

  // 1. Stop accepting new connections
  server.close(async (err) => {
    if (err) {
      logger.error('[Shutdown] Error closing HTTP server:', err);
      process.exit(1);
    }

    try {
      // 2. Disconnect from all infrastructure
      await redis.close();
      await prisma.$disconnect();

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
