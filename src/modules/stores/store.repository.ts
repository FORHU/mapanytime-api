import { Prisma } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import S3Util from '../../utils/s3.util';

export interface NearbyStore {
  id: string;
  storeName: string;
  description: string | null;
  isActive: boolean;
  distanceKm: number;
  coordinates: { lat: number; lng: number };
  logoUrl: string | null;
  rating: number;
  ratingCount: number;
  categoryId: string | null;
  categoryName: string | null;
  isOpen: boolean;
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
  logoUrl: string | null;
  ratingAverage: number;
  ratingCount: number;
  categoryId: string | null;
  categoryName: string | null;
  hoursIsClosed: boolean | null;
  openMinutes: number | null;
  closeMinutes: number | null;
  latitude: number;
  longitude: number;
  currentAddress: string;
  city: string;
  province: string;
  country: string;
  distanceKm: number;
}

// No hours row for today (isClosed is null) defaults to open — matches the
// app's prior client-side default when hours are unknown.
function isOpenNow(
  isClosed: boolean | null,
  openMinutes: number | null,
  closeMinutes: number | null,
  now = new Date(),
): boolean {
  if (isClosed === null) return true;
  if (isClosed) return false;
  if (openMinutes == null || closeMinutes == null) return true;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return nowMinutes >= openMinutes && nowMinutes < closeMinutes;
}

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
    offset: number,
    categoryIds: string[] | undefined,
    centerLat: number,
    centerLng: number,
    search?: string,
    todayDow?: number,
  ): Promise<{ items: NearbyStore[]; total: number }> {
    const dow = todayDow ?? new Date().getDay();
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

    const term = search?.trim();
    const searchFilter =
      term && term.length > 0
        ? Prisma.sql`
          AND (
            s."storeName" ILIKE ${`%${term}%`}
            OR s."description" ILIKE ${`%${term}%`}
          )
        `
        : Prisma.sql``;

    const inViewport = Prisma.sql`
      s."isActive" = true
      AND l."latitude" BETWEEN ${south} AND ${north}
      AND l."longitude" BETWEEN ${west} AND ${east}
      ${searchFilter}
    `;

    const rows = await prisma.$queryRaw<NearbyRow[]>(Prisma.sql`
      SELECT DISTINCT
        s."id", s."storeName", s."description", s."isActive",
        f."path" AS "logoUrl",
        s."ratingAverage", s."ratingCount",
        s."primaryCategoryId" AS "categoryId",
        h."isClosed" AS "hoursIsClosed", h."openMinutes", h."closeMinutes",
        l."latitude", l."longitude",
        l."currentAddress", l."city", l."province", l."country",
        ROUND((${distanceKm})::numeric, 2) AS "distanceKm",
        (
          SELECT c."name"
          FROM "Categories" c
          JOIN "_CategoriesToStores" cs_inner ON cs_inner."A" = c."id"
          WHERE cs_inner."B" = s."id" AND c."parentId" IS NULL
          LIMIT 1
        ) AS "categoryName"
      FROM "Stores" s
      JOIN "StoreLocations" l ON l."storeId" = s."id"
      LEFT JOIN "Files" f ON f."id" = s."logoId"
      LEFT JOIN "StoreHours" h ON h."storeId" = s."id" AND h."dayOfWeek" = ${dow}
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
      logoUrl: S3Util.getPublicUrl(r.logoUrl),
      rating: Number(r.ratingAverage),
      ratingCount: r.ratingCount,
      categoryId: r.categoryId,
      categoryName: r.categoryName,
      isOpen: isOpenNow(r.hoursIsClosed, r.openMinutes, r.closeMinutes),
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
      orderBy: { createdAt: 'desc' },
    });
  }

  static async getStoreById(id: string) {
    return prisma.stores.findUnique({
      where: { id },
      include: {
        storeLocations: true,
        storeHours: {
          orderBy: { dayOfWeek: 'asc' },
        },
        categories: true,
        primaryCategory: true,
        merchantAds: {
          where: { isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
          include: {
            products: {
              include: {
                product: { include: { inventory: true } },
                variant: { include: { inventory: true } },
              },
            },
          },
        },
      },
    });
  }

  static async getStoreProducts(storeId: string, limit: number, offset: number) {
    const [items, total] = await Promise.all([
      prisma.products.findMany({
        where: { storeId, isActive: true, deletedAt: null },
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        include: {
          category: true,
          productImages: {
            include: { file: true },
            orderBy: { displayOrder: 'asc' },
          },
        },
      }),
      prisma.products.count({
        where: { storeId, isActive: true, deletedAt: null },
      }),
    ]);
    return { items, total };
  }
}
