import StoreRepository from '../repositories/store.repository';
import { redisConnection } from '../infrastructure/redis/connection';
import logger from '../utils/logger';

export default class StoreService {
  static async getNearbyStores(
    userLat: number,
    userLng: number,
    radiusKm: number,
    limit: number = 100,
  ) {
    // Geospatial cache bucketing: Round coordinates to 2 decimal places (approx ~1.1km grid cells)
    // This dramatically increases cache hit rate when panning across the map.
    const latBucket = userLat.toFixed(2);
    const lngBucket = userLng.toFixed(2);
    const cacheKey = `stores:nearby:${latBucket}:${lngBucket}:${radiusKm.toFixed(1)}:${limit}`;

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

    // The database now handles the filtering, sorting, and math!
    const stores = await StoreRepository.getNearbyStores(userLat, userLng, radiusKm, limit);

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
