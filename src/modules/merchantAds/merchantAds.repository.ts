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
}
