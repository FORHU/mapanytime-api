import { prisma } from '../utils/prisma';

export default class StoreRepository {
  static async getActiveStoresWithLocations() {
    return prisma.stores.findMany({
      where: { isActive: true },
      include: { storeLocations: true },
    });
  }

  static async getNearbyStores(lat: number, lng: number, radiusKm: number, limit: number) {
    // 1 degree of latitude is approx 111km.
    const latOffset = radiusKm / 111.0;
    // 1 degree of longitude varies by latitude, but max is ~111km at the equator.
    const lngOffset = radiusKm / (111.0 * Math.cos(lat * (Math.PI / 180)));

    // Highly optimized Postgres raw SQL using bounding-box pre-filter + Haversine
    const stores = await prisma.$queryRaw`
      SELECT 
        s.*, 
        sl.latitude, 
        sl.longitude,
        sl."currentAddress",
        sl.city,
        sl.province,
        sl.country,
        (6371 * acos(
          GREATEST(-1.0, LEAST(1.0, cos(radians(${lat})) * cos(radians(sl.latitude)) * 
          cos(radians(sl.longitude) - radians(${lng})) + 
          sin(radians(${lat})) * sin(radians(sl.latitude))))
        )) AS "DistanceKm"
      FROM "Stores" s
      JOIN "StoreLocations" sl ON s.id = sl."storeId"
      WHERE s."isActive" = true
        AND sl.latitude BETWEEN ${lat - latOffset} AND ${lat + latOffset}
        AND sl.longitude BETWEEN ${lng - lngOffset} AND ${lng + lngOffset}
        AND (6371 * acos(
          GREATEST(-1.0, LEAST(1.0, cos(radians(${lat})) * cos(radians(sl.latitude)) * 
          cos(radians(sl.longitude) - radians(${lng})) + 
          sin(radians(${lat})) * sin(radians(sl.latitude))))
        )) <= ${radiusKm}
      ORDER BY "DistanceKm" ASC
      LIMIT ${limit};
    `;

    type RawStoreRow = {
      id: string;
      sellerId: string;
      storeName: string;
      description: string | null;
      isActive: boolean;
      createdAt: Date;
      updatedAt: Date;
      latitude: number;
      longitude: number;
      currentAddress: string;
      city: string;
      province: string;
      country: string;
      DistanceKm: number;
    };

    // Map the flat SQL result back into the expected nested object structure
    return (stores as RawStoreRow[]).map((row) => ({
      id: row.id,
      sellerId: row.sellerId,
      storeName: row.storeName,
      description: row.description,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      DistanceKm: row.DistanceKm,
      storeLocations: {
        latitude: row.latitude,
        longitude: row.longitude,
        currentAddress: row.currentAddress,
        city: row.city,
        province: row.province,
        country: row.country,
      },
    }));
  }
}
