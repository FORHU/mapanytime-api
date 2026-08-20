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
  kind?: 'PROMO' | 'JOB' | 'EVENT';
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
  goal?: 'STORE_VISITS' | 'IMPRESSIONS' | 'PURCHASES';
  format?: 'MAP_FLOATING_CARD' | 'PROMOTED_PIN' | 'DISCOVERY_CAROUSEL' | 'SPONSORED_SEARCH';
  radiusKm?: number;
  targetLat?: number;
  targetLng?: number;
  dailyBudget?: number;
  totalBudget?: number;
  expiresAt?: Date;
  products?: { productId: string; variantId?: string }[];
}

interface CreateAdPayload extends AdFields {
  storeId: string;
}

export default class MerchantAdsService {
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
    return seller;
  }

  static async listMyAds(userId: string, storeId: string) {
    await this.assertOwnership(userId, storeId);
    return MerchantAdsRepository.getAdsByStoreId(storeId);
  }

  static async listAllMyAds(userId: string) {
    const seller = await MerchantAdsRepository.getSellerByUserId(userId);
    if (!seller) {
      throw { status: 403, message: 'Only sellers can access merchant ads.' };
    }
    return MerchantAdsRepository.getAdsBySellerId(seller.id);
  }

  static async createAd(userId: string, payload: CreateAdPayload) {
    await this.assertOwnership(userId, payload.storeId);

    const { storeId, products, ...adFields } = payload;

    return MerchantAdsRepository.createAd({
      ...adFields,
      kind: adFields.kind || 'PROMO',
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

    // Ads referenced by past orders are kept so the order history stays
    // readable. Disabling is offered as the alternative rather than performed
    // silently — a delete call that quietly does something else is worse.
    const orderItemCount = await MerchantAdsRepository.countOrderItemsByAdId(adId);
    if (orderItemCount > 0) {
      throw {
        status: 409,
        message:
          'This ad has been applied to past orders and cannot be deleted. Disable it instead.',
      };
    }

    await MerchantAdsRepository.deleteAd(adId);
    return { deleted: true as const };
  }

  static async trackEvent(
    adId: string,
    data: {
      eventType: 'IMPRESSION' | 'CLICK' | 'CONVERSION';
      buyerId?: string;
      sessionId?: string;
      orderId?: string;
      ipAddress?: string;
      userAgent?: string;
    },
  ) {
    const ad = await MerchantAdsRepository.getAdById(adId);
    if (!ad) throw { status: 404, message: 'Merchant ad not found.' };

    // Attributed revenue is read from the order rather than taken from the
    // request: this endpoint is public, and the figure drives ROAS and billing.
    // Only a paid order for the ad's own store counts.
    let revenueAmount = 0;
    if (data.eventType === 'CONVERSION' && data.orderId) {
      const order = await MerchantAdsRepository.getAttributableOrder(data.orderId, ad.storeId);
      revenueAmount = order ? Number(order.totalAmount) : 0;
    }

    await MerchantAdsRepository.recordAdEvent({ adId, ...data, revenueAmount });

    await MerchantAdsRepository.incrementAdMetrics(adId, {
      impressions: data.eventType === 'IMPRESSION' ? 1 : 0,
      clicks: data.eventType === 'CLICK' ? 1 : 0,
      conversions: data.eventType === 'CONVERSION' ? 1 : 0,
      revenue: revenueAmount,
    });
  }

  static async getAnalytics(userId: string, adId: string) {
    const ad = await MerchantAdsRepository.getAdById(adId);
    if (!ad) throw { status: 404, message: 'Merchant ad not found.' };
    await this.assertOwnership(userId, ad.storeId);

    return MerchantAdsRepository.getAdAnalytics(adId);
  }

  static async getNearbyDeals(
    north: number,
    south: number,
    east: number,
    west: number,
    userLat?: number,
    userLng?: number,
    limit: number = 20,
  ) {
    const nearbyResult = await StoreService.getNearbyStores(
      north,
      south,
      east,
      west,
      limit,
      0,
      undefined,
      userLat,
      userLng,
    );

    const nearbyStores: NearbyStore[] = nearbyResult.items ?? [];
    if (nearbyStores.length === 0) return [];

    const storeIds = nearbyStores.map((s) => s.id);
    const rawAds = await MerchantAdsRepository.findManyForStores(storeIds, limit * 3);

    // filterLiveAds' parameter type is narrowed to what store.service.ts needs
    // and drops productImages, so the live ids are taken from it and the richer
    // records are kept.
    const liveIds = new Set(
      filterLiveAds(rawAds as unknown as MerchantAdWithProducts[]).map((a) => a.id),
    );
    const liveAds = rawAds.filter((ad) => liveIds.has(ad.id));

    const storeMap = new Map(nearbyStores.map((s) => [s.id, s]));

    const deals = await Promise.all(
      liveAds.slice(0, limit).map(async (ad) => {
        const store = storeMap.get(ad.storeId);
        const firstProduct = ad.products[0]?.product;
        const primaryImage = firstProduct?.productImages?.[0]?.file;
        const productImageUrl = primaryImage ? await resolveImageUrl(primaryImage) : null;

        return {
          id: ad.id,
          storeId: ad.storeId,
          storeName: store?.storeName ?? ad.store.storeName,
          storeSlug: ad.store.slug ?? '',
          distanceKm: store?.distanceKm ?? null,
          title: ad.title,
          description: ad.description,
          badgeLabel: ad.badgeLabel,
          ctaLabel: ad.ctaLabel,
          discountType: ad.discountType,
          discountValue: ad.discountValue ? Number(ad.discountValue) : null,
          buyQuantity: ad.buyQuantity,
          freeQuantity: ad.freeQuantity,
          imageUrl: ad.imageUrl ?? productImageUrl,
          expiresAt: ad.expiresAt,
          isPromoted: ad.dailyBudget ? Number(ad.dailyBudget) > 0 : false,
        };
      }),
    );

    return deals;
  }
}
