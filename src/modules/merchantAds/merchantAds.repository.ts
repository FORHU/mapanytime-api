import { Prisma, ADWINDOWSTATE } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import { liveWindowFilter, overlappingWindowFilter } from './adWindow';

export default class MerchantAdsRepository {
  static async getSellerByUserId(userId: string) {
    return prisma.sellers.findUnique({ where: { userId } });
  }

  static async getStoreById(storeId: string) {
    return prisma.stores.findUnique({ where: { id: storeId } });
  }

  static async listActiveBadges() {
    return prisma.promotionBadges.findMany({
      where: { isActive: true },
      orderBy: { position: 'asc' },
    });
  }

  static async getBadgeById(badgeId: string) {
    return prisma.promotionBadges.findUnique({ where: { id: badgeId } });
  }

  /**
   * The zone every wall-clock time for this store's ads is interpreted in.
   * Falls back to the column default rather than the server's zone — a server
   * relocated to another region must not silently reinterpret stored schedules.
   */
  static async getStoreTimezone(storeId: string): Promise<string> {
    const location = await prisma.storeLocations.findUnique({
      where: { storeId },
      select: { timezone: true },
    });
    return location?.timezone ?? 'Asia/Manila';
  }

  static async getStoreTimezones(storeIds: string[]): Promise<Map<string, string>> {
    const locations = await prisma.storeLocations.findMany({
      where: { storeId: { in: storeIds } },
      select: { storeId: true, timezone: true },
    });
    return new Map(locations.map((l) => [l.storeId, l.timezone]));
  }

  /**
   * Discount ads in the same store whose window overlaps `window` and which
   * touch at least one of `productIds`.
   *
   * Deliberately narrow. Overlap is only harmful when two promotions would
   * apply competing prices to the same product at the same instant — a store
   * legitimately runs a store-visits ad, a job post and an event at once.
   * Variant-level precision is settled by the caller, which has both sides'
   * product links.
   */
  static async findWindowConflicts(
    storeId: string,
    window: { startAt: Date | null; expiresAt: Date | null },
    productIds: string[],
    excludeAdId?: string,
  ) {
    return prisma.merchantAds.findMany({
      where: {
        storeId,
        kind: 'PROMO',
        discountType: { not: null },
        ...(excludeAdId ? { id: { not: excludeAdId } } : {}),
        products: { some: { productId: { in: productIds } } },
        ...overlappingWindowFilter(window),
      },
      select: {
        id: true,
        title: true,
        startAt: true,
        expiresAt: true,
        products: { select: { productId: true, variantId: true } },
      },
    });
  }

  static async getAdById(adId: string) {
    return prisma.merchantAds.findUnique({
      where: { id: adId },
      include: {
        store: { select: { id: true, storeName: true, sellerId: true } },
        products: { select: { productId: true, variantId: true } },
      },
    });
  }

  static async getAdsByStoreId(storeId: string) {
    return prisma.merchantAds.findMany({
      where: { storeId },
      orderBy: { createdAt: 'desc' },
      include: { products: { select: { productId: true, variantId: true } } },
    });
  }

  static async getAdsBySellerId(sellerId: string) {
    return prisma.merchantAds.findMany({
      where: { store: { sellerId } },
      orderBy: { createdAt: 'desc' },
      include: {
        store: { select: { id: true, storeName: true } },
        products: { select: { productId: true, variantId: true } },
      },
    });
  }

  static async createAd(data: Prisma.MerchantAdsCreateInput) {
    return prisma.merchantAds.create({ data });
  }

  static async setActive(adId: string, isActive: boolean) {
    return prisma.merchantAds.update({
      where: { id: adId },
      data: { isActive },
    });
  }

  static async updateAd(adId: string, data: Prisma.MerchantAdsUpdateInput) {
    return prisma.merchantAds.update({ where: { id: adId }, data });
  }

  static async replaceAdProducts(
    adId: string,
    products: { productId: string; variantId?: string }[],
  ) {
    return prisma.$transaction([
      prisma.merchantAdProducts.deleteMany({ where: { adId } }),
      ...(products.length > 0
        ? [
            prisma.merchantAdProducts.createMany({
              data: products.map((p) => ({
                adId,
                productId: p.productId,
                variantId: p.variantId,
              })),
            }),
          ]
        : []),
    ]);
  }

  /**
   * Candidates for the transition sweep.
   *
   * Deliberately NOT "what changed in the last minute" — an edge-triggered
   * query loses every transition that happened while the worker was restarting.
   * This returns everything not yet in its terminal state and lets the caller
   * compare derived-vs-recorded, so a worker down for an hour catches up on its
   * next tick instead of silently dropping an hour of transitions.
   */
  static async findAdsNeedingTransition(take = 500) {
    return prisma.merchantAds.findMany({
      where: { NOT: { lastNotifiedState: 'ENDED' } },
      select: {
        id: true,
        storeId: true,
        title: true,
        startAt: true,
        expiresAt: true,
        isActive: true,
        lastNotifiedState: true,
      },
      take,
    });
  }

  static async markNotifiedState(adId: string, state: ADWINDOWSTATE) {
    return prisma.merchantAds.update({
      where: { id: adId },
      data: { lastNotifiedState: state },
    });
  }

  static async countOrderItemsByAdId(adId: string) {
    return prisma.orderItems.count({ where: { appliedAdId: adId } });
  }

  static async deleteAd(adId: string) {
    return prisma.merchantAds.delete({ where: { id: adId } });
  }

  /** Paid order belonging to the ad's own store, or null if it does not qualify. */
  static async getAttributableOrder(orderId: string, storeId: string) {
    return prisma.orders.findFirst({
      where: { id: orderId, storeId, payment: { some: { status: 'COMPLETED' } } },
      select: { id: true, totalAmount: true },
    });
  }

  static async recordAdEvent(data: {
    adId: string;
    eventType: 'IMPRESSION' | 'CLICK' | 'CONVERSION';
    buyerId?: string;
    sessionId?: string;
    orderId?: string;
    revenueAmount?: number;
    ipAddress?: string;
    userAgent?: string;
  }) {
    return prisma.adEvents.create({ data });
  }

  static async incrementAdMetrics(
    adId: string,
    delta: { impressions?: number; clicks?: number; conversions?: number; revenue?: number },
  ) {
    return prisma.merchantAds.update({
      where: { id: adId },
      data: {
        ...(delta.impressions ? { impressionsCount: { increment: delta.impressions } } : {}),
        ...(delta.clicks ? { clicksCount: { increment: delta.clicks } } : {}),
        ...(delta.conversions ? { conversionsCount: { increment: delta.conversions } } : {}),
        ...(delta.revenue ? { attributedRevenue: { increment: delta.revenue } } : {}),
      },
    });
  }

  static async getAdAnalytics(adId: string) {
    const ad = await prisma.merchantAds.findUnique({
      where: { id: adId },
      select: {
        id: true,
        title: true,
        dailyBudget: true,
        totalBudget: true,
        spentAmount: true,
        impressionsCount: true,
        clicksCount: true,
        conversionsCount: true,
        attributedRevenue: true,
      },
    });

    if (!ad) return null;

    const spent = Number(ad.spentAmount) || 0;
    const revenue = Number(ad.attributedRevenue) || 0;
    const roas = spent > 0 ? Number((revenue / spent).toFixed(2)) : 0;
    const ctr =
      ad.impressionsCount > 0
        ? Number(((ad.clicksCount / ad.impressionsCount) * 100).toFixed(2))
        : 0;

    return {
      ...ad,
      roas,
      ctrPercentage: ctr,
    };
  }

  static async findManyForStores(storeIds: string[], take: number, now: Date = new Date()) {
    return prisma.merchantAds.findMany({
      where: {
        storeId: { in: storeIds },
        discountType: { not: null },
        products: { some: {} },
        // Liveness is evaluated inside the query, so a promotion appears at its
        // exact start instant with no job involved. liveWindowFilter is the SQL
        // twin of deriveAdState()'s LIVE branch — the two are tested together.
        ...liveWindowFilter(now),
      },
      include: {
        // The nearby-store projection carries no slug, so it is read here.
        store: { select: { storeName: true, slug: true } },
        products: {
          include: {
            product: {
              include: {
                inventory: true,
                productImages: {
                  where: { isPrimary: true },
                  include: { file: { select: { path: true, bucket: true } } },
                  take: 1,
                },
              },
            },
            variant: { include: { inventory: true } },
          },
        },
      },
      take,
    });
  }
}
