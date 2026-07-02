import StoreRepository from '../repositories/store.repository';
import { redisConnection } from '../infrastructure/redis/connection';
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
    return prisma.$transaction(async (tx) => {
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
  }

  static async getNearbyStores(
    north: number,
    south: number,
    east: number,
    west: number,
    limit: number,
    centerLat?: number,
    centerLng?: number,
  ) {
    // Default center to midpoint of the bounding box if not explicitly provided
    const lat = centerLat ?? (north + south) / 2;
    const lng = centerLng ?? (east + west) / 2;

    // Cache key buckets to 2 decimal places for better hit rates on similar viewports
    const n = north.toFixed(2);
    const s = south.toFixed(2);
    const e = east.toFixed(2);
    const w = west.toFixed(2);
    const cLat = lat.toFixed(2);
    const cLng = lng.toFixed(2);
    const cacheKey = `stores:viewport:${n}:${s}:${e}:${w}:c:${cLat}:${cLng}:limit:${limit}`;

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

    const stores = await StoreRepository.getNearbyStores(north, south, east, west, limit, lat, lng);

    try {
      const redis = redisConnection.getClient();
      // Cache for 60 seconds
      await redis.setEx(cacheKey, 60, JSON.stringify(stores));
    } catch (err) {
      logger.warn(`[Redis] Cache write failed for ${cacheKey}.`);
    }

    return stores;
  }

  static async getMyStores(sellerId: string) {
    return StoreRepository.getStoresBySellerId(sellerId);
  }
}
