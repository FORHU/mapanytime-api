import StoreRepository from '../repositories/store.repository';
import { redisConnection } from '../infrastructure/redis/connection';
import logger from '../utils/logger';

export default class StoreService {
  static async getNearbyStores(
    north: number,
    south: number,
    east: number,
    west: number,
    limit: number,
  ) {
    // Generate a Redis cache key based on the viewport, bucketing to 2 decimal places
    // to improve cache hit rates for roughly similar panning areas
    const n = north.toFixed(2);
    const s = south.toFixed(2);
    const e = east.toFixed(2);
    const w = west.toFixed(2);
    const cacheKey = `stores:viewport:${n}:${s}:${e}:${w}:limit:${limit}`;

    try {
      const redis = redisConnection.getClient();
      const cached = await redis.get(cacheKey);
      
      if (cached) {
        logger.info(`[Redis] Cache hit for ${cacheKey}`);
        return JSON.parse(cached);
      }
    } catch (err) {
      logger.warn(`[Redis] Cache read failed for ${cacheKey}, falling back to DB. (Is Redis running?)`);
    }

    // The database now strictly filters by the viewport bounding box
    const stores = await StoreRepository.getNearbyStores(north, south, east, west, limit);

    try {
      const redis = redisConnection.getClient();
      // Cache the heavy Prisma GIS query for 60 seconds
      await redis.setEx(cacheKey, 60, JSON.stringify(stores));
    } catch (err) {
      logger.warn(`[Redis] Cache write failed for ${cacheKey}.`);
    }

    return stores;
  }
}
