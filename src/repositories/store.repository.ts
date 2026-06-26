import { prisma } from '../utils/prisma';

export default class StoreRepository {
  static async getActiveStoresWithLocations() {
    return prisma.stores.findMany({
      where: { isActive: true },
      include: { storeLocations: true },
    });
  }

  static async getNearbyStores(north: number, south: number, east: number, west: number, limit: number) {
    // Pure viewport bounding box query - incredibly fast since it fully utilizes indexing
    // without requiring expensive Haversine trigonometric distance math on 50,000+ rows.
    const stores = await prisma.$queryRaw`
      SELECT 
        s.*, 
        sl.latitude, 
        sl.longitude,
        sl."currentAddress",
        sl.city,
        sl.province,
        sl.country
      FROM "Stores" s
      JOIN "StoreLocations" sl ON s.id = sl."storeId"
      WHERE s."isActive" = true
        AND sl.latitude BETWEEN ${south} AND ${north}
        AND sl.longitude BETWEEN ${west} AND ${east}
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
