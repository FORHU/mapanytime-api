import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';

/** A single store row returned by the distance-ordered viewport query. */
export interface NearbyStore {
  id: string;
  storeName: string;
  description: string | null;
  isActive: boolean;
  distanceKm: number;
  coordinates: { lat: number; lng: number };
  address: {
    currentAddress: string;
    city: string;
    province: string;
    country: string;
  };
}

interface NearbyRow {
  id: string;
  storeName: string;
  description: string | null;
  isActive: boolean;
  latitude: number;
  longitude: number;
  currentAddress: string;
  city: string;
  province: string;
  country: string;
  distanceKm: string; // Postgres NUMERIC → string over the wire
}

export default class StoreRepository {
  static async getActiveStoresWithLocations() {
    return prisma.stores.findMany({
      where: { isActive: true },
      include: { storeLocations: true },
    });
  }

  /**
   * Distance-ordered, paginated stores within a viewport bounding box.
   *
   * The haversine distance and ORDER BY happen in Postgres, so the "nearest N"
   * is always correct regardless of how many stores fall inside the box (the
   * old in-memory approach capped at 1000 arbitrary rows before sorting, which
   * could miss genuinely-nearer stores). Returns the page plus the total count
   * in the box so callers can compute `hasMore`.
   */
  static async getNearbyStores(
    north: number,
    south: number,
    east: number,
    west: number,
    limit: number,
    offset: number,
    categoryIds: string[] | undefined,
    centerLat: number,
    centerLng: number,
  ): Promise<{ items: NearbyStore[]; total: number }> {
    // Great-circle distance (km) expressed in SQL, mirroring geo.util's
    // haversineKm so client-side and server-side numbers agree.
    const distanceKm = Prisma.sql`
      6371 * 2 * asin(sqrt(
        power(sin(radians(l."latitude" - ${centerLat}) / 2), 2) +
        cos(radians(${centerLat})) * cos(radians(l."latitude")) *
        power(sin(radians(l."longitude" - ${centerLng}) / 2), 2)
      ))
    `;

    const categoryJoin =
      categoryIds && categoryIds.length > 0
        ? Prisma.sql`
          JOIN "_CategoriesToStores" cs ON cs."B" = s."id"
          AND cs."A" IN (${Prisma.join(
            categoryIds.map((id) => Prisma.sql`${id}`),
            ', ',
          )})
        `
        : Prisma.sql``;

    const inViewport = Prisma.sql`
      s."isActive" = true
      AND l."latitude" BETWEEN ${south} AND ${north}
      AND l."longitude" BETWEEN ${west} AND ${east}
    `;

    const rows = await prisma.$queryRaw<NearbyRow[]>(Prisma.sql`
      SELECT DISTINCT
        s."id", s."storeName", s."description", s."isActive",
        l."latitude", l."longitude",
        l."currentAddress", l."city", l."province", l."country",
        ROUND((${distanceKm})::numeric, 2) AS "distanceKm"
      FROM "Stores" s
      JOIN "StoreLocations" l ON l."storeId" = s."id"
      ${categoryJoin}
      WHERE ${inViewport}
      ORDER BY "distanceKm" ASC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const totalRows = await prisma.$queryRaw<{ count: number }[]>(Prisma.sql`
      SELECT COUNT(DISTINCT s."id")::int AS count
      FROM "Stores" s
      JOIN "StoreLocations" l ON l."storeId" = s."id"
      ${categoryJoin}
      WHERE ${inViewport}
    `);

    const items: NearbyStore[] = rows.map((r) => ({
      id: r.id,
      storeName: r.storeName,
      description: r.description,
      isActive: r.isActive,
      distanceKm: Number(r.distanceKm),
      coordinates: { lat: r.latitude, lng: r.longitude },
      address: {
        currentAddress: r.currentAddress,
        city: r.city,
        province: r.province,
        country: r.country,
      },
    }));

    return { items, total: Number(totalRows[0]?.count ?? 0) };
  }

  static async getStoresBySellerId(sellerId: string) {
    return prisma.stores.findMany({
      where: { sellerId: sellerId },
      include: { storeLocations: true },
      orderBy: { createdAt: 'desc' }, // Optional: puts newest stores at the top
    });
  }
}
