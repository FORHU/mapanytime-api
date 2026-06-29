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
    centerLat?: number,
    centerLng?: number,
  ) {
    // Default center to midpoint of the bounding box if not explicitly provided
    const lat = centerLat ?? (north + south) / 2;
    const lng = centerLng ?? (east + west) / 2;

    // Cache key buckets to 2 decimal places for better hit rates on similar viewports
    const n = north.toFixed(2);
    const s = south.toFixed(2);
    const e = east.toFixed(2);
    const w = west.toFixed(2);
    const cLat = lat.toFixed(2);
    const cLng = lng.toFixed(2);
    const cacheKey = `stores:viewport:${n}:${s}:${e}:${w}:c:${cLat}:${cLng}:limit:${limit}`;

    try {
      const redis = redisConnection.getClient();
      const cached = await redis.get(cacheKey);

      if (cached) {
        logger.info(`[Redis] Cache hit for ${cacheKey}`);
        return JSON.parse(cached);
      }
    } catch (err) {
      logger.warn(
        `[Redis] Cache read failed for ${cacheKey}, falling back to DB. (Is Redis running?)`,
      );
    }

    const stores = await StoreRepository.getNearbyStores(north, south, east, west, limit, lat, lng);

    try {
      const redis = redisConnection.getClient();
      // Cache for 60 seconds
      await redis.setEx(cacheKey, 60, JSON.stringify(stores));
    } catch (err) {
      logger.warn(`[Redis] Cache write failed for ${cacheKey}.`);
    }

    return stores;
  }
}
