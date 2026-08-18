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
    return prisma.merchantAds.findUnique({ where: { id: adId } });
  }

  static async getAdsByStoreId(storeId: string) {
    return prisma.merchantAds.findMany({
      where: { storeId },
      orderBy: { createdAt: 'desc' },
      include: { products: { select: { productId: true, variantId: true } } },
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
