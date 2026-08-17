import CategoryRepository from '../categories/category.repository';
import StoreRepository from './store.repository';
import { redisConnection } from '../../infrastructure/redis/connection';
import { emitStoreUpserted } from '../../infrastructure/socket';
import logger from '../../utils/logger';
import { Prisma } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import { S3_CDN_URL } from '../../config';
import S3Util from '../../utils/s3.util';

async function resolveImageUrl(file: { path: string; bucket?: string | null }): Promise<string> {
  if (S3_CDN_URL) return `${S3_CDN_URL}/${file.path}`;
  return S3Util.getFileUrl(file.path);
}

type MerchantAdWithProducts = Prisma.MerchantAdsGetPayload<{
  include: {
    products: {
      include: {
        product: { include: { inventory: true } };
        variant: { include: { inventory: true } };
      };
    };
  };
}>;

// EVENT (or any stock-linked) ads end when their linked stock sells out.
// quantityOnHand - quantityReserved, not raw quantityOnHand, since Inventory
// only decrements quantityOnHand at fulfillment — pending orders already
// reserved units shouldn't still count as available here.
function filterLiveAds(ads: MerchantAdWithProducts[]) {
  return ads.filter((ad) => {
    if (ad.products.length === 0) return true;
    const available = ad.products.reduce((sum, p) => {
      const inv = p.variant?.inventory[0] ?? p.product.inventory[0];
      return sum + (inv ? inv.quantityOnHand - inv.quantityReserved : 0);
    }, 0);
    return available > 0;
  });
}

export default class StoreService {
  static async createStoreWithDocuments(
    sellerId: string,
    storeData: {
      storeName: string;
      description?: string;
      categoryIds: string[];
      email?: string;
      phone?: string;
    },
    locationData: Prisma.StoreLocationsCreateWithoutStoreInput,
    hoursData: Prisma.StoreHoursCreateWithoutStoreInput[],
    rawDocuments?: Partial<{
      mayorsPermitFileName: string;
      mayorsPermitKey: string;
      dtiCertificateFileName: string;
      dtiCertificateKey: string;
      birCertificateFileName: string;
      birCertificateKey: string;
      secCertificateFileName: string;
      secCertificateKey: string;
    }>,
    options?: { completeOnboarding?: boolean },
  ) {
    const uploadedFiles = rawDocuments
      ? [
          ...(rawDocuments.mayorsPermitFileName && rawDocuments.mayorsPermitKey
            ? [
                {
                  fileName: rawDocuments.mayorsPermitFileName,
                  fileUrl: rawDocuments.mayorsPermitKey,
                  documentType: 'MAYORS_PERMIT' as const,
                },
              ]
            : []),
          ...(rawDocuments.dtiCertificateFileName && rawDocuments.dtiCertificateKey
            ? [
                {
                  fileName: rawDocuments.dtiCertificateFileName,
                  fileUrl: rawDocuments.dtiCertificateKey,
                  documentType: 'DTI_CERTIFICATE' as const,
                },
              ]
            : []),
          ...(rawDocuments.birCertificateFileName && rawDocuments.birCertificateKey
            ? [
                {
                  fileName: rawDocuments.birCertificateFileName,
                  fileUrl: rawDocuments.birCertificateKey,
                  documentType: 'BIR_CERTIFICATE' as const,
                },
              ]
            : []),
          ...(rawDocuments.secCertificateFileName && rawDocuments.secCertificateKey
            ? [
                {
                  fileName: rawDocuments.secCertificateFileName,
                  fileUrl: rawDocuments.secCertificateKey,
                  documentType: 'SEC_CERTIFICATE' as const,
                },
              ]
            : []),
        ]
      : [];

    const created = await prisma.$transaction(async (tx) => {
      const newStore = await tx.stores.create({
        data: {
          sellerId,
          storeName: storeData.storeName,
          description: storeData.description,
          email: storeData.email,
          phone: storeData.phone,
          isActive: false,
          storeLocations: { create: locationData },
          storeHours: { create: hoursData },
          categories: {
            connect: storeData.categoryIds.map((id) => ({ id })),
          },
        },
      });

      const docVerification = await tx.documentVerifications.create({
        data: {
          sellerId,
          storeId: newStore.id,
          verificationStatus: 'PENDING',
        },
      });

      for (const file of uploadedFiles) {
        const savedFile = await tx.files.create({
          data: {
            uploadedById: sellerId,
            filename: file.fileName,
            originalName: file.fileName,
            mimeType: 'application/octet-stream',
            size: 0,
            path: file.fileUrl,
          },
        });

        await tx.documents.create({
          data: {
            documentVerificationsId: docVerification.id,
            fileId: savedFile.id,
            documentType: file.documentType,
          },
        });
      }

      if (options?.completeOnboarding) {
        const seller = await tx.sellers.findUnique({ where: { id: sellerId } });
        if (!seller) throw { status: 404, message: 'Seller not found' };

        await tx.sellers.update({
          where: { id: sellerId },
          data: {
            onboardingStep: 3,
            isOnboarded: true,
            onboardedAt: new Date(),
          },
        });

        await tx.users.update({
          where: { id: seller.userId },
          data: { isOnBoarding: false },
        });
      }

      return tx.stores.findUnique({
        where: { id: newStore.id },
        include: {
          storeLocations: true,
          documentVerifications: { include: { documents: true } },
        },
      });
    });

    try {
      if (created && created.storeLocations) {
        emitStoreUpserted({
          id: created.id,
          storeName: created.storeName,
          isActive: created.isActive,
          coordinates: {
            lat: created.storeLocations.latitude,
            lng: created.storeLocations.longitude,
          },
        });
      }
    } catch (err) {
      logger.warn(`[Socket] Failed to emit store:upserted for new store.`);
    }

    return created;
  }

  static async getNearbyStores(
    north: number,
    south: number,
    east: number,
    west: number,
    limit: number,
    offset: number,
    categoryId?: string,
    centerLat?: number,
    centerLng?: number,
    search?: string,
  ) {
    const lat = centerLat ?? (north + south) / 2;
    const lng = centerLng ?? (east + west) / 2;

    const n = north.toFixed(2);
    const s = south.toFixed(2);
    const e = east.toFixed(2);
    const w = west.toFixed(2);
    const cLat = lat.toFixed(2);
    const cLng = lng.toFixed(2);
    const searchKey = search?.trim().toLowerCase() || 'none';
    const cacheKey = `stores:viewport:${n}:${s}:${e}:${w}:c:${cLat}:${cLng}:limit:${limit}:offset:${offset}:category:${categoryId ?? 'none'}:search:${searchKey}`;

    try {
      const redis = redisConnection.getClient();
      const cached = await redis?.get(cacheKey);

      if (cached) {
        logger.info(`[Redis] Cache hit for ${cacheKey}`);
        return JSON.parse(cached);
      }
    } catch (err) {
      logger.warn(
        `[Redis] Cache read failed for ${cacheKey}, falling back to DB. (Is Redis running?)`,
      );
    }

    let categoryIds: string[] | undefined;
    if (categoryId) {
      const category = await CategoryRepository.findByIdOrName(categoryId);
      if (!category) {
        throw { status: 404, message: 'Category not found.' };
      }
      categoryIds = await CategoryRepository.getDescendantCategoryIds(category.id);
    }

    const { items, total } = await StoreRepository.getNearbyStores(
      north,
      south,
      east,
      west,
      limit,
      offset,
      categoryIds,
      lat,
      lng,
      search,
      new Date().getDay(),
    );

    const result = {
      items,
      total,
      limit,
      offset,
      hasMore: offset + items.length < total,
    };

    try {
      const redis = redisConnection.getClient();
      await redis?.setEx(cacheKey, 60, JSON.stringify(result));
    } catch (err) {
      logger.warn(`[Redis] Cache write failed for ${cacheKey}.`);
    }

    return result;
  }

  static async getMyStores(sellerId: string) {
    return StoreRepository.getStoresBySellerId(sellerId);
  }

  /**
   * Partial update of a store the given seller owns.
   *
   * Deliberately does NOT go through getStoreById — that helper 404s on an
   * inactive store, which would make a deactivated store impossible to edit
   * back into shape. Ownership is checked here rather than in the controller so
   * every future caller inherits it.
   */
  static async updateStore(
    storeId: string,
    sellerId: string,
    input: {
      storeName?: string;
      description?: string | null;
      phone?: string | number;
      email?: string;
      categoryId?: string;
      isActive?: boolean;
      currentAddress?: string;
      city?: string;
      province?: string;
      postalCode?: string | number;
      country?: string;
    },
  ) {
    const existing = await StoreRepository.getStoreById(storeId);
    if (!existing) throw { status: 404, message: 'Store not found.' };
    if (existing.sellerId !== sellerId) {
      // 404 rather than 403: a seller has no business learning which store ids
      // belong to other sellers.
      throw { status: 404, message: 'Store not found.' };
    }

    const storeData: Prisma.StoresUpdateInput = {};
    if (input.storeName !== undefined) storeData.storeName = input.storeName;
    if (input.description !== undefined) storeData.description = input.description || null;
    if (input.phone !== undefined) storeData.phone = String(input.phone) || null;
    if (input.email !== undefined) storeData.email = input.email || null;
    if (input.isActive !== undefined) storeData.isActive = input.isActive;
    if (input.categoryId !== undefined) {
      storeData.primaryCategory = { connect: { id: input.categoryId } };
    }

    const locationData: Prisma.StoreLocationsUpdateWithoutStoreInput = {};
    if (input.currentAddress !== undefined) locationData.currentAddress = input.currentAddress;
    if (input.city !== undefined) locationData.city = input.city;
    if (input.province !== undefined) locationData.province = input.province;
    if (input.postalCode !== undefined) locationData.zipCode = String(input.postalCode);
    if (input.country !== undefined) locationData.country = input.country;

    const hasLocationChanges = Object.keys(locationData).length > 0;

    const updated = await prisma.$transaction(async (tx) => {
      if (Object.keys(storeData).length > 0) {
        await tx.stores.update({ where: { id: storeId }, data: storeData });
      }

      // StoreLocations is optional on Stores, so a store onboarded without one
      // has nothing to update. Skip rather than throwing — the store fields
      // above are still a legitimate edit on their own.
      if (hasLocationChanges && existing.storeLocations) {
        await tx.storeLocations.update({
          where: { storeId },
          data: locationData,
        });
      }

      return tx.stores.findUnique({
        where: { id: storeId },
        include: { storeLocations: true },
      });
    });

    // Name, visibility and coordinates are all denormalised into the map
    // viewport payload, so a stale cache would keep serving the old values.
    try {
      if (updated && updated.storeLocations) {
        emitStoreUpserted({
          id: updated.id,
          storeName: updated.storeName,
          isActive: updated.isActive,
          coordinates: {
            lat: updated.storeLocations.latitude,
            lng: updated.storeLocations.longitude,
          },
        });
      }
    } catch (err) {
      logger.warn(`[Socket] Failed to emit store:upserted for updated store ${storeId}.`);
    }

    return updated;
  }

  static async getStoreById(id: string) {
    const store = await StoreRepository.getStoreById(id);

    if (!store) {
      throw { status: 404, message: 'Store not found.' };
    }

    if (!store.isActive) {
      throw { status: 404, message: 'Store is not currently active.' };
    }

    return { ...store, merchantAds: filterLiveAds(store.merchantAds) };
  }

  static async getStoreProducts(storeId: string, limit: number, offset: number) {
    // Verify store exists first
    const store = await StoreRepository.getStoreById(storeId);
    if (!store) throw { status: 404, message: 'Store not found.' };

    const { items, total } = await StoreRepository.getStoreProducts(storeId, limit, offset);
    const resolved = await Promise.all(
      items.map(async (product) => ({
        ...product,
        productImages: await Promise.all(
          product.productImages.map(async (pi) => ({
            ...pi,
            file: { ...pi.file, url: await resolveImageUrl(pi.file) },
          })),
        ),
      })),
    );
    return {
      items: resolved,
      total,
      limit,
      offset,
      hasMore: offset + items.length < total,
    };
  }
}
