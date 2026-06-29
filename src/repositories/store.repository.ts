import { prisma } from '../utils/prisma';
import { haversineKm, roundKm } from '../utils/geo.util';

// Defensive cap on how many in-viewport rows we pull into memory before
// computing distances. Stops a zoomed-out viewport (e.g. a whole country)
// from loading an unbounded result set into the Node process.
const MAX_VIEWPORT_ROWS = 1000;

export default class StoreRepository {
  static async getActiveStoresWithLocations() {
    return prisma.stores.findMany({
      where: { isActive: true },
      include: { storeLocations: true },
    });
  }

  static async getNearbyStores(
    north: number,
    south: number,
    east: number,
    west: number,
    limit: number,
    centerLat: number,
    centerLng: number,
  ) {
    // 1. Prisma does the bounding-box filter (indexed Float columns). No raw
    //    SQL — the query is type-checked, so a malformed clause can't compile.
    const rows = await prisma.stores.findMany({
      where: {
        isActive: true,
        storeLocations: {
          latitude: { gte: south, lte: north },
          longitude: { gte: west, lte: east },
        },
      },
      include: { storeLocations: true },
      take: MAX_VIEWPORT_ROWS,
    });

    // 2. Haversine distance in TypeScript, then sort nearest-first and keep
    //    only the requested number. The relation filter guarantees a location
    //    exists, but TS still types it as nullable, so we guard.
    return rows
      .filter((row) => row.storeLocations !== null)
      .map((row) => {
        const loc = row.storeLocations!;
        return {
          id: row.id,
          storeName: row.storeName,
          description: row.description,
          isActive: row.isActive,
          distanceKm: roundKm(haversineKm(centerLat, centerLng, loc.latitude, loc.longitude)),
          coordinates: {
            lat: loc.latitude,
            lng: loc.longitude,
          },
          address: {
            currentAddress: loc.currentAddress,
            city: loc.city,
            province: loc.province,
            country: loc.country,
          },
        };
      })
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, limit);
  }
  
  static async getStoresBySellerId(sellerId: string) {
    return prisma.stores.findMany({
      where: { sellerId: sellerId },
      include: { storeLocations: true },
      orderBy: { createdAt: 'desc' } // Optional: puts newest stores at the top
    });
  }
}
