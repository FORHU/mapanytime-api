import { Prisma } from '@prisma/client';
import { prisma } from '../../utils/prisma';

export default class MerchantAdsRepository {
  static async getSellerByUserId(userId: string) {
    return prisma.sellers.findUnique({ where: { userId } });
  }

  static async getStoreById(storeId: string) {
    return prisma.stores.findUnique({ where: { id: storeId } });
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

  static async findManyForStores(storeIds: string[], take: number) {
    return prisma.merchantAds.findMany({
      where: {
        storeId: { in: storeIds },
        isActive: true,
        discountType: { not: null },
        products: { some: {} },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
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
