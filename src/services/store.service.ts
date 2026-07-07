import CategoryRepository from '../repositories/category.repository';
import StoreRepository from '../repositories/store.repository';
import { redisConnection } from '../infrastructure/redis/connection';
import { emitStoreUpserted } from '../infrastructure/socket';
import logger from '../utils/logger';
import { Prisma, DOCUMENTTYPES } from '@prisma/client';
import { prisma } from '../utils/prisma';

// Define the expected shapes of the incoming data
interface FileUploadData {
  fileName: string;
  fileUrl: string;
  documentType: DOCUMENTTYPES;
}
export default class StoreService {
  static async createStoreWithDocuments(
    sellerId: string,
    storeData: { storeName: string; description?: string },
    locationData: Prisma.StoreLocationsCreateWithoutStoreInput,
    hoursData: Prisma.StoreHoursCreateWithoutStoreInput[],
    uploadedFiles: FileUploadData[],
  ) {
    const created = await prisma.$transaction(async (tx) => {
      // 1. Create the Store along with its Location and Hours
      const newStore = await tx.stores.create({
        data: {
          sellerId,
          storeName: storeData.storeName,
          description: storeData.description,
          isActive: false, // Default state requiring admin approval
          storeLocations: {
            create: locationData,
          },
          storeHours: {
            create: hoursData,
          },
        },
      });

      // 2. Create the Document Verification record for this specific branch
      const docVerification = await tx.documentVerifications.create({
        data: {
          sellerId,
          storeId: newStore.id,
          verificationStatus: 'PENDING',
        },
      });

      // 3. Process each uploaded file, create its File record, and link it as a Document
      for (const file of uploadedFiles) {
        // A. Save the file metadata
        const savedFile = await tx.files.create({
          data: {
            userId: sellerId, // Mapping back to the user who uploaded it
            fileName: file.fileName,
            fileUrl: file.fileUrl,
          },
        });

        // B. Link the File to the Verification record
        await tx.documents.create({
          data: {
            documentVerificationsId: docVerification.id,
            fileId: savedFile.id,
            documentType: file.documentType,
          },
        });
      }

      // Return the newly created store with its relations for the frontend
      return tx.stores.findUnique({
        where: { id: newStore.id },
        include: {
          storeLocations: true,
          documentVerifications: {
            include: { documents: true },
          },
        },
      });
    });

    // Notify clients viewing this region in real time. Best-effort: a socket
    // failure must never fail store creation.
    try {
      if (created) {
        emitStoreUpserted({
          id: created.id,
          storeName: created.storeName,
          isActive: created.isActive,
          coordinates: {
            lat: locationData.latitude,
            lng: locationData.longitude,
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
    // Default center to midpoint of the bounding box if not explicitly provided
    const lat = centerLat ?? (north + south) / 2;
    const lng = centerLng ?? (east + west) / 2;

    // Cache key buckets to 2 decimal places for better hit rates on similar
    // viewports; page (limit/offset) is part of the key so each page is cached
    // independently.
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
      // Cache for 60 seconds
      await redis.setEx(cacheKey, 60, JSON.stringify(result));
    } catch (err) {
      logger.warn(`[Redis] Cache write failed for ${cacheKey}.`);
    }

    return result;
  }

  static async getMyStores(sellerId: string) {
    return StoreRepository.getStoresBySellerId(sellerId);
  }
}
