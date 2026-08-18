import { MERCHANTDISCOUNTTYPE } from '@prisma/client';
import MerchantAdsRepository from './merchantAds.repository';
import StoreService, { filterLiveAds, type MerchantAdWithProducts } from '../stores/store.service';
import type { NearbyStore } from '../stores/store.repository';
import { S3_CDN_URL } from '../../config';
import S3Util from '../../utils/s3.util';

async function resolveImageUrl(file: { path: string; bucket?: string | null }): Promise<string> {
  if (S3_CDN_URL) return `${S3_CDN_URL}/${file.path}`;
  return S3Util.getFileUrl(file.path);
}

interface AdFields {
  kind: 'PROMO' | 'JOB' | 'EVENT';
  title: string;
  description: string;
  imageUrl?: string;
  badgeLabel?: string;
  ctaLabel?: string;
  salaryLabel?: string;
  buyQuantity?: number;
  freeQuantity?: number;
  discountType?: MERCHANTDISCOUNTTYPE;
  discountValue?: number;
  expiresAt?: Date;
  products?: { productId: string; variantId?: string }[];
}

interface CreateAdPayload extends AdFields {
  storeId: string;
}

export default class MerchantAdsService {
  // Every ad mutation is gated by the same seller-owns-store check; centralized
  // so create/update/delete/toggle can't drift out of sync on the auth rule.
  private static async assertOwnership(userId: string, storeId: string) {
    const seller = await MerchantAdsRepository.getSellerByUserId(userId);
    if (!seller) {
      throw { status: 403, message: 'Only sellers can manage merchant ads.' };
    }

    const store = await MerchantAdsRepository.getStoreById(storeId);
    if (!store) {
      throw { status: 404, message: 'Store not found.' };
    }

    if (store.sellerId !== seller.id) {
      throw { status: 403, message: 'You do not own this store.' };
    }
  }

  static async listMyAds(userId: string, storeId: string) {
    await this.assertOwnership(userId, storeId);
    return MerchantAdsRepository.getAdsByStoreId(storeId);
  }

  static async createAd(userId: string, payload: CreateAdPayload) {
    await this.assertOwnership(userId, payload.storeId);

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

  static async setActive(userId: string, adId: string, isActive: boolean) {
    const ad = await MerchantAdsRepository.getAdById(adId);
    if (!ad) {
      throw { status: 404, message: 'Merchant ad not found.' };
    }

    await this.assertOwnership(userId, ad.storeId);

    return MerchantAdsRepository.setActive(adId, isActive);
  }

  static async updateAd(userId: string, adId: string, payload: AdFields) {
    const ad = await MerchantAdsRepository.getAdById(adId);
    if (!ad) {
      throw { status: 404, message: 'Merchant ad not found.' };
    }

    await this.assertOwnership(userId, ad.storeId);

    const { products, ...adFields } = payload;

    const updated = await MerchantAdsRepository.updateAd(adId, adFields);

    if (products) {
      await MerchantAdsRepository.replaceAdProducts(adId, products);
    }

    return updated;
  }

  static async deleteAd(userId: string, adId: string) {
    const ad = await MerchantAdsRepository.getAdById(adId);
    if (!ad) {
      throw { status: 404, message: 'Merchant ad not found.' };
    }

    await this.assertOwnership(userId, ad.storeId);

    const orderItemCount = await MerchantAdsRepository.countOrderItemsByAdId(adId);
    if (orderItemCount > 0) {
      throw {
        status: 409,
        message:
          'This ad has been applied to past orders and cannot be deleted. Disable it instead.',
      };
    }

    return MerchantAdsRepository.deleteAd(adId);
  }

  static async getNearbyDeals(
    north: number,
    south: number,
    east: number,
    west: number,
    lat: number | undefined,
    lng: number | undefined,
    limit: number,
  ) {
    // Reuses the store module's existing Redis-cached nearby query instead of
    // duplicating the Haversine-distance SQL here.
    const nearby = await StoreService.getNearbyStores(
      north,
      south,
      east,
      west,
      50,
      0,
      undefined,
      lat,
      lng,
      undefined,
    );
    const stores: NearbyStore[] = nearby.items;
    if (stores.length === 0) return [];

    const storeById = new Map(stores.map((s) => [s.id, s]));
    const ads = await MerchantAdsRepository.findManyForStores(
      stores.map((s) => s.id),
      limit,
    );

    // Filter via the shared stock-check, then keep the original (richer)
    // records so the productImages field survives — filterLiveAds' return
    // type is narrowed to what store.service.ts needs, which doesn't include it.
    const liveIds = new Set(filterLiveAds(ads as MerchantAdWithProducts[]).map((a) => a.id));
    const live = ads.filter((ad) => liveIds.has(ad.id));

    return Promise.all(
      live.map(async (ad) => {
        const store = storeById.get(ad.storeId)!;
        const link = ad.products[0];
        const image = link?.product.productImages[0];

        return {
          id: ad.id,
          kind: ad.kind,
          title: ad.title,
          description: ad.description,
          imageUrl: ad.imageUrl,
          badgeLabel: ad.badgeLabel,
          ctaLabel: ad.ctaLabel,
          discountType: ad.discountType,
          discountValue: ad.discountValue,
          buyQuantity: ad.buyQuantity,
          freeQuantity: ad.freeQuantity,
          expiresAt: ad.expiresAt,
          storeId: ad.storeId,
          storeName: store.storeName,
          distanceKm: store.distanceKm,
          product: link
            ? {
                id: link.product.id,
                name: link.product.name,
                price: link.product.price,
                imageUrl: image ? await resolveImageUrl(image.file) : null,
              }
            : null,
        };
      }),
    );
  }
}
