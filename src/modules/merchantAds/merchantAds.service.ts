import MerchantAdsRepository from './merchantAds.repository';

interface CreateAdPayload {
  storeId: string;
  kind: 'PROMO' | 'JOB' | 'EVENT';
  title: string;
  description: string;
  imageUrl?: string;
  badgeLabel?: string;
  ctaLabel?: string;
  salaryLabel?: string;
  buyQuantity?: number;
  freeQuantity?: number;
  expiresAt?: Date;
  products?: { productId: string; variantId?: string }[];
}

export default class MerchantAdsService {
  static async listMyAds(userId: string, storeId: string) {
    const seller = await MerchantAdsRepository.getSellerByUserId(userId);
    if (!seller) {
      throw { status: 403, message: 'Only sellers can view merchant ads.' };
    }

    const store = await MerchantAdsRepository.getStoreById(storeId);
    if (!store) {
      throw { status: 404, message: 'Store not found.' };
    }

    if (store.sellerId !== seller.id) {
      throw { status: 403, message: 'You do not own this store.' };
    }

    return MerchantAdsRepository.getAdsByStoreId(storeId);
  }

  static async createAd(userId: string, payload: CreateAdPayload) {
    const seller = await MerchantAdsRepository.getSellerByUserId(userId);
    if (!seller) {
      throw { status: 403, message: 'Only sellers can create merchant ads.' };
    }

    const store = await MerchantAdsRepository.getStoreById(payload.storeId);
    if (!store) {
      throw { status: 404, message: 'Store not found.' };
    }

    if (store.sellerId !== seller.id) {
      throw { status: 403, message: 'You do not own this store.' };
    }

    const { storeId, products, ...adFields } = payload;

    return MerchantAdsRepository.createAd({
      ...adFields,
      store: { connect: { id: storeId } },
      products:
        products && products.length > 0
          ? {
              create: products.map((p) => ({
                product: { connect: { id: p.productId } },
                ...(p.variantId ? { variant: { connect: { id: p.variantId } } } : {}),
              })),
            }
          : undefined,
    });
  }

  static async archiveAd(userId: string, adId: string) {
    const ad = await MerchantAdsRepository.getAdById(adId);
    if (!ad) {
      throw { status: 404, message: 'Merchant ad not found.' };
    }

    const store = await MerchantAdsRepository.getStoreById(ad.storeId);
    const seller = await MerchantAdsRepository.getSellerByUserId(userId);

    if (!seller || !store || store.sellerId !== seller.id) {
      throw { status: 403, message: 'Unauthorized to delete this merchant ad.' };
    }

    return MerchantAdsRepository.archiveAd(adId);
  }
}
