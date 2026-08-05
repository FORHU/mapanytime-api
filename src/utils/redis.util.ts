import { createClient, RedisClientType } from 'redis';
import { REDIS_HOST, REDIS_PASSWORD, REDIS_PORT } from '../config';

export default class RedisUtil {
  static client: RedisClientType;

  static async initialize() {
    try {
      this.client = createClient({
        password: REDIS_PASSWORD,
        socket: {
          host: REDIS_HOST,
          port: REDIS_PORT,
          connectTimeout: 3000,
        },
      }) as RedisClientType;

      this.client.on('error', (err) => console.error('[RedisUtil] Client Error:', err.message));

      await this.client.connect();
      console.log(`[RedisUtil] Connected to ${REDIS_HOST}:${REDIS_PORT}`);
    } catch (err) {
      console.warn(`[RedisUtil] Could not connect to Redis (${(err as Error).message}). Rate limiting bypassed.`);
    }
  }

  /**
   * Simple fixed-window rate limiter
   */
  static async isRateLimited(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    if (!this.client?.isOpen) return false;
    try {
      const count = await this.client.incr(`ratelimit:${key}`);
      if (count === 1) await this.client.expire(`ratelimit:${key}`, windowSeconds);
      return count > limit;
    } catch {
      return false;
    }
  }
}
