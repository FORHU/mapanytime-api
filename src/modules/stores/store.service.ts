import CategoryRepository from '../../repositories/category.repository';
import StoreRepository from '../../repositories/store.repository';
import { redisConnection } from '../../infrastructure/redis/connection';
import { emitStoreUpserted } from '../../infrastructure/socket';
import logger from '../../utils/logger';
import { Prisma } from '@prisma/client';
import { prisma } from '../../utils/prisma';

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
            ? [{
            fileName: rawDocuments.mayorsPermitFileName,
            fileUrl: rawDocuments.mayorsPermitKey,
            documentType: 'MAYORS_PERMIT' as const,
            }]
            : []),
          ...(rawDocuments.dtiCertificateFileName && rawDocuments.dtiCertificateKey
            ? [{
            fileName: rawDocuments.dtiCertificateFileName,
            fileUrl: rawDocuments.dtiCertificateKey,
            documentType: 'DTI_CERTIFICATE' as const,
            }]
            : []),
          ...(rawDocuments.birCertificateFileName && rawDocuments.birCertificateKey
            ? [{
            fileName: rawDocuments.birCertificateFileName,
            fileUrl: rawDocuments.birCertificateKey,
            documentType: 'BIR_CERTIFICATE' as const,
            }]
            : []),
          ...(rawDocuments.secCertificateFileName && rawDocuments.secCertificateKey
            ? [{
            fileName: rawDocuments.secCertificateFileName,
            fileUrl: rawDocuments.secCertificateKey,
            documentType: 'SEC_CERTIFICATE' as const,
            }]
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
      const cached = await redis.get(cacheKey);

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
      await redis.setEx(cacheKey, 60, JSON.stringify(result));
    } catch (err) {
      logger.warn(`[Redis] Cache write failed for ${cacheKey}.`);
    }

    return result;
  }

  static async getMyStores(sellerId: string) {
    return StoreRepository.getStoresBySellerId(sellerId);
  }

  static async getStoreById(id: string) {
    const store = await StoreRepository.getStoreById(id);

    if (!store) {
      throw { status: 404, message: 'Store not found.' };
    }

    if (!store.isActive) {
      throw { status: 404, message: 'Store is not currently active.' };
    }

    return store;
  }
}
