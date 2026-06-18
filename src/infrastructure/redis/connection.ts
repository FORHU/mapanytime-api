import { createClient, RedisClientType } from 'redis';
import { REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, REDIS_TLS } from '../../config';
import logger from '../../utils/logger';

const CONNECT_TIMEOUT_MS = 10_000;

class RedisConnection {
  private client: RedisClientType | null = null;
  private isConnected = false;

  public async connect(): Promise<void> {
    if (this.isConnected && this.client) return;

    this.client = createClient({
      socket: {
        host: REDIS_HOST,
        port: REDIS_PORT,
        connectTimeout: CONNECT_TIMEOUT_MS,
        // TLS is required for managed Redis services (AWS ElastiCache, Upstash, etc.)
        ...(REDIS_TLS ? { tls: true as const } : {}),
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            logger.error('[Redis] Max reconnect attempts reached. Giving up.');
            return new Error('Too many reconnect attempts');
          }
          const delay = Math.min(retries * 500, 5000);
          logger.warn(`[Redis] Reconnecting in ${delay}ms (attempt ${retries})...`);
          return delay;
        },
      },
      password: REDIS_PASSWORD || undefined,
    }) as RedisClientType;

    this.client.on('error', (err) => logger.error('[Redis] Client error:', err));
    this.client.on('connect', () => logger.info('[Redis] Connected.'));
    this.client.on('reconnecting', () => logger.warn('[Redis] Reconnecting...'));
    this.client.on('end', () => {
      this.isConnected = false;
      logger.warn('[Redis] Connection closed.');
    });

    // Enforce a hard connection timeout via Promise.race
    await Promise.race([
      this.client.connect(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`[Redis] Connection timed out after ${CONNECT_TIMEOUT_MS}ms`)),
          CONNECT_TIMEOUT_MS,
        ),
      ),
    ]);

    this.isConnected = true;
    logger.info(`[Redis] Connected to ${REDIS_HOST}:${REDIS_PORT}${REDIS_TLS ? ' (TLS)' : ''}`);
  }

  public getClient(): RedisClientType {
    if (!this.client || !this.isConnected) {
      throw new Error('[Redis] Client not initialized. Call connect() first.');
    }
    return this.client;
  }

  public async ping(): Promise<boolean> {
    try {
      const result = await this.getClient().ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  public async close(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.isConnected = false;
      logger.info('[Redis] Connection closed gracefully.');
    }
  }
}

export const redisConnection = new RedisConnection();
