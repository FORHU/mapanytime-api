import { REDIS_TTL_SECONDS } from '../config';
import logger from './logger';
import { redis } from '../infrastructure/redis';

export default class CacheUtil {
  private static client() {
    return redis.getClient();
  }

  static async get<T = unknown>(key: string): Promise<T | null> {
    try {
      const data = await this.client().get(key);
      if (!data) return null;
      return JSON.parse(data) as T;
    } catch (error) {
      logger.error(`[CacheUtil:get] Failed to get key ${key}:`, error);
      return null;
    }
  }

  static async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      const ttl = ttlSeconds || REDIS_TTL_SECONDS;
      if (ttl > 0) {
        await this.client().setEx(key, ttl, serialized);
      } else {
        await this.client().set(key, serialized);
      }
    } catch (error) {
      logger.error(`[CacheUtil:set] Failed to set key ${key}:`, error);
    }
  }

  static async del(key: string): Promise<void> {
    try {
      await this.client().del(key);
    } catch (error) {
      logger.error(`[CacheUtil:del] Failed to delete key ${key}:`, error);
    }
  }

  static async delByPattern(pattern: string): Promise<void> {
    try {
      const keys = await this.client().keys(pattern);
      if (keys.length) await this.client().del(keys);
    } catch (error) {
      logger.error(`[CacheUtil:delByPattern] Failed to delete pattern ${pattern}:`, error);
    }
  }

  static async flushAll(): Promise<void> {
    try {
      await this.client().flushAll();
      logger.info('[CacheUtil] Redis cache flushed successfully');
    } catch (error) {
      logger.error('[CacheUtil:flushAll] Failed to flush cache:', error);
      throw error;
    }
  }

  /**
   * Cache-aside helper: return the cached value if present, otherwise run
   * `fn`, cache its result with `ttlSeconds`, and return it.
   *
   * If Redis is unreachable, `fn` still runs and its result is returned —
   * the cache layer never blocks the caller.
   *
   * Usage:
   *   const user = await CacheUtil.remember(
   *     `user:${id}`,
   *     300,
   *     () => UserRepository.findById(id),
   *   );
   */
  static async remember<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
    const hit = await this.get<T>(key);
    if (hit !== null && hit !== undefined) return hit;

    const fresh = await fn();
    // Don't cache null/undefined — usually means "not found" and should
    // re-check the source next time rather than being remembered as missing.
    if (fresh !== null && fresh !== undefined) {
      await this.set(key, fresh, ttlSeconds);
    }
    return fresh;
  }
}
