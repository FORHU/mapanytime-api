import CategoryRepository from '../categories/category.repository';
import StoreRepository from './store.repository';
import { redisConnection } from '../../infrastructure/redis/connection';
import { emitStoreRemoved, emitStoreUpserted } from '../../infrastructure/socket';
import logger from '../../utils/logger';
import { Prisma } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import { S3_CDN_URL } from '../../config';
import S3Util from '../../utils/s3.util';
import type { OrgContext } from '../organization/orgContext';
import StoreApprovalService, {
  EDITABLE_STATUSES,
  REJECTED_STORE_TTL_MS,
} from '../adminApprovals/storeApproval.service';

/**
 * Audit action for both deletion paths. One action with a `reason` in the
 * metadata rather than two, so the store's timeline can be read without knowing
 * which of the two removed it.
 */
export const STORE_DELETED_ACTION = 'STORE_DELETED';

async function resolveImageUrl(file: { path: string; bucket?: string | null }): Promise<string> {
  if (S3_CDN_URL) return `${S3_CDN_URL}/${file.path}`;
  return S3Util.getFileUrl(file.path);
}

// Replaces the raw logoFile/bannerFile relations (internal S3 keys) with
// public URLs, the same way the public /stores/nearby listing already does.
function withPhotoUrls<
  T extends { logoFile: { path: string } | null; bannerFile: { path: string } | null },
>(entity: T) {
  const { logoFile, bannerFile, ...rest } = entity;
  return {
    ...rest,
    logoUrl: logoFile ? S3Util.getPublicUrl(logoFile.path) : null,
    bannerUrl: bannerFile ? S3Util.getPublicUrl(bannerFile.path) : null,
  };
}

export type MerchantAdWithProducts = Prisma.MerchantAdsGetPayload<{
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
// only decrements quantityOnHand at fulfillment â€” pending orders already
// reserved units shouldn't still count as available here.
export function filterLiveAds(ads: MerchantAdWithProducts[]) {
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
  /**
   * `orgId` is gone from this signature: a store's organization is its seller,
   * so `sellerId` carries both and a second argument could only ever disagree
   * with it.
   */
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
          // Creation is the first submission. The admin queue orders on this
          // rather than createdAt so a store that has been through a revision
          // round takes its new place in line.
          lastSubmittedAt: new Date(),
          primaryCategoryId: storeData.categoryIds[0] ?? null,
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

  static async getMyStores(scope: Prisma.StoresWhereInput) {
    const stores = await StoreRepository.getStoresByScope(scope);

    // The deadline is computed here rather than by the client. The frontend
    // renders a countdown, and a countdown built from the client's own idea of
    // "24 hours" would disagree with the sweep the moment either changes.
    return stores.map((store) => ({
      ...store,
      scheduledDeletionAt:
        store.approvalStatus === 'REJECTED' && store.rejectedAt
          ? new Date(store.rejectedAt.getTime() + REJECTED_STORE_TTL_MS)
          : null,
    }));
  }

  /**
   * Partial update of a store the given seller owns.
   *
   * Deliberately does NOT go through getStoreById â€” that helper 404s on an
   * inactive store, which would make a deactivated store impossible to edit
   * back into shape. Ownership is checked here rather than in the controller so
   * every future caller inherits it.
   */
  static async updateStore(
    context: OrgContext,
    storeId: string,
    input: {
      storeName?: string;
      description?: string | null;
      phone?: string | number;
      email?: string;
      categoryId?: string;
      isActive?: boolean;
      bannerId?: string | null;
      currentAddress?: string;
      city?: string;
      province?: string;
      postalCode?: string | number;
      country?: string;
    },
  ) {
    const existing = await StoreRepository.getStoreById(storeId);
    if (!existing) throw { status: 404, message: 'Store not found.' };

    // Org-scoped ownership: the store must belong to the caller's organization
    // and (for staff) to their assigned set. 404 rather than 403 so a caller
    // cannot probe which store ids exist outside their scope.
    if (!context.organizationId || existing.sellerId !== context.organizationId) {
      throw { status: 404, message: 'Store not found.' };
    }
    if (!context.isAdmin && context.assignedStoreIds) {
      if (!context.assignedStoreIds.includes(storeId)) {
        throw { status: 404, message: 'Store not found.' };
      }
    }

    // A store waiting on an administrator is frozen, so the reviewer always
    // judges the submission they were handed. NEEDS_REVISION is the state that
    // unlocks editing again — that is the entire point of it — and ACTIVE stays
    // editable because an approved seller must be able to keep their storefront
    // current. This is the single enforcement point: PATCH is the only
    // seller-facing writer of store fields.
    if (!EDITABLE_STATUSES.includes(existing.approvalStatus)) {
      throw {
        status: 409,
        message:
          existing.approvalStatus === 'UNDER_REVIEW'
            ? 'This store is being reviewed by an administrator and cannot be edited right now.'
            : 'This store is awaiting review and cannot be edited right now.',
        code: 'STORE_LOCKED_FOR_REVIEW',
      };
    }

    const storeData: Prisma.StoresUpdateInput = {};
    if (input.storeName !== undefined) storeData.storeName = input.storeName;
    if (input.description !== undefined) storeData.description = input.description || null;
    if (input.phone !== undefined) storeData.phone = String(input.phone) || null;
    if (input.email !== undefined) storeData.email = input.email || null;
    if (input.isActive !== undefined) storeData.isActive = input.isActive;
    if (input.categoryId !== undefined) {
      const category = await CategoryRepository.findById(input.categoryId);

      if (!category) throw { status: 404, message: 'Category not found.' };

      // The scalar and the join table are separate relations, so both have to be
      // written or they drift: the map viewport filters on the join table while
      // the same query reports the scalar as `categoryId`. `set` replaces the
      // whole M2M set rather than adding to it, so no stale row can survive.
      storeData.primaryCategory = { connect: { id: input.categoryId } };
      storeData.categories = { set: [{ id: input.categoryId }] };
    }
    if (input.bannerId !== undefined) {
      storeData.bannerFile =
        input.bannerId === null ? { disconnect: true } : { connect: { id: input.bannerId } };
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
      // has nothing to update. Skip rather than throwing â€” the store fields
      // above are still a legitimate edit on their own.
      if (hasLocationChanges && existing.storeLocations) {
        await tx.storeLocations.update({
          where: { storeId },
          data: locationData,
        });
      }

      return tx.stores.findUnique({
        where: { id: storeId },
        include: { storeLocations: true, logoFile: true, bannerFile: true },
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

    return updated ? withPhotoUrls(updated) : updated;
  }

  /**
   * Seller pushes a revised store back into the review queue.
   *
   * Repeats the org-scope check from `updateStore` rather than leaning on the
   * route middleware alone, for the same reason that one does: every caller of
   * this service inherits the ownership rule, not just the ones mounted behind
   * the right stack. The status rule itself lives in the transition matrix.
   */
  static async resubmitForReview(context: OrgContext, storeId: string, actorUserId: string) {
    const existing = await StoreRepository.getStoreById(storeId);
    if (!existing) throw { status: 404, message: 'Store not found.' };

    if (!context.organizationId || existing.sellerId !== context.organizationId) {
      throw { status: 404, message: 'Store not found.' };
    }
    if (!context.isAdmin && context.assignedStoreIds) {
      if (!context.assignedStoreIds.includes(storeId)) {
        throw { status: 404, message: 'Store not found.' };
      }
    }

    return StoreApprovalService.resubmit(storeId, actorUserId);
  }

  /**
   * Seller removes a store their application was rejected for.
   *
   * Soft delete, never a hard one. Every required foreign key into Stores is ON
   * DELETE RESTRICT, and a store rejected out of ACTIVE can carry orders and
   * settlements â€” a real delete would either be refused by the database or, if
   * the children were cleared first, destroy financial history to tidy up a
   * seller's dashboard. `deletedAt` costs a filter and orphans nothing.
   *
   * Repeats the org-scope check from `updateStore` rather than leaning on the
   * route middleware, for the reason that one gives: the rule belongs to every
   * caller of the service, not only to the requests routed through the right
   * middleware stack.
   */
  static async deleteRejectedStore(context: OrgContext, storeId: string, actorUserId: string) {
    const existing = await StoreRepository.getStoreById(storeId);
    if (!existing) throw { status: 404, message: 'Store not found.' };

    if (!context.organizationId || existing.sellerId !== context.organizationId) {
      throw { status: 404, message: 'Store not found.' };
    }
    if (!context.isAdmin && context.assignedStoreIds) {
      if (!context.assignedStoreIds.includes(storeId)) {
        throw { status: 404, message: 'Store not found.' };
      }
    }

    // The rule the whole feature rests on. The button is hidden for every other
    // status, but this is what actually holds: the endpoint is reachable
    // directly, and a PENDING store must not be deletable to dodge a review.
    if (existing.approvalStatus !== 'REJECTED') {
      throw {
        status: 409,
        message: 'Only rejected stores can be deleted.',
        code: 'STORE_NOT_REJECTED',
      };
    }

    await prisma.$transaction(async (tx) => {
      // Compare-and-set on both columns: an admin reopening the store for appeal
      // in the same instant must win, rather than have the seller's click delete
      // a store that is no longer rejected.
      const { count } = await tx.stores.updateMany({
        where: { id: storeId, approvalStatus: 'REJECTED', deletedAt: null },
        data: { deletedAt: new Date(), isActive: false },
      });

      if (count === 0) {
        throw {
          status: 409,
          message: 'This store was updated by someone else. Reload and try again.',
          code: 'CONCURRENT_MODIFICATION',
        };
      }

      // Inside the transaction so a logged deletion always corresponds to one
      // that landed, matching how store transitions are audited.
      await tx.auditLogs.create({
        data: {
          performedById: actorUserId,
          action: STORE_DELETED_ACTION,
          entityType: 'STORE',
          entityId: storeId,
          metadata: { reason: 'SELLER_DELETED_REJECTED' } as Prisma.InputJsonObject,
        },
      });
    });

    await this.afterStoreRemoved(existing.sellerId, [storeId], {
      [storeId]: existing.storeLocations,
    });

    return { id: storeId };
  }

  /**
   * Remove rejected stores whose 24-hour window has run out.
   *
   * Idempotent by construction: `deletedAt: null` is in the WHERE, so a second
   * run in the same hour matches nothing and reports 0. `now` is injectable so
   * the window can be tested without waiting a day for it.
   */
  static async purgeExpiredRejectedStores(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - REJECTED_STORE_TTL_MS);

    const expired = await prisma.stores.findMany({
      where: {
        approvalStatus: 'REJECTED',
        deletedAt: null,
        // A rejected row with no `rejectedAt` predates this column and is left
        // alone: `lte` already excludes null, and starting a window we never
        // showed the seller would delete a store with no warning.
        rejectedAt: { lte: cutoff },
      },
      select: { id: true, sellerId: true, storeLocations: true },
    });

    if (expired.length === 0) return 0;

    const ids = expired.map((store) => store.id);

    const deleted = await prisma.$transaction(async (tx) => {
      const { count } = await tx.stores.updateMany({
        where: { id: { in: ids }, approvalStatus: 'REJECTED', deletedAt: null },
        data: { deletedAt: now, isActive: false },
      });

      if (count === 0) return 0;

      await tx.auditLogs.createMany({
        data: ids.map((id) => ({
          // No actor: the expiry is the system acting on a rule, and attributing
          // it to the rejecting admin would misread the history later.
          performedById: null,
          action: STORE_DELETED_ACTION,
          entityType: 'STORE',
          entityId: id,
          metadata: { reason: 'REJECTION_EXPIRED' } as Prisma.InputJsonObject,
        })),
      });

      return count;
    });

    if (deleted === 0) return 0;

    // Grouped by organization so each seller's assignment lists are rewritten
    // once, however many of their stores expired in the same sweep.
    const byOrg = new Map<string, string[]>();
    const locations = Object.fromEntries(expired.map((s) => [s.id, s.storeLocations]));
    for (const store of expired) {
      byOrg.set(store.sellerId, [...(byOrg.get(store.sellerId) ?? []), store.id]);
    }
    for (const [sellerId, storeIds] of byOrg) {
      await this.afterStoreRemoved(sellerId, storeIds, locations);
    }

    return deleted;
  }

  /**
   * The cleanup both deletion paths owe, run after the commit and never able to
   * fail one: a store that is gone from the database must not come back because
   * a socket was down or a staff assignment list would not rewrite.
   */
  private static async afterStoreRemoved(
    sellerId: string,
    storeIds: string[],
    locations: Record<string, { latitude: number; longitude: number } | null | undefined>,
  ) {
    // `assignedStoreIds` is a scalar String[] with no foreign key, so nothing in
    // the database prunes it. Left alone, every deleted store leaves a dangling
    // id in the staff lists that `storeScopeWhere` and `requireStoreInScope`
    // read on every request.
    try {
      const members = await prisma.sellerOrganizationMembers.findMany({
        where: { sellerId, assignedStoreIds: { hasSome: storeIds } },
        select: { id: true, assignedStoreIds: true },
      });

      await Promise.all(
        members.map((member) =>
          prisma.sellerOrganizationMembers.update({
            where: { id: member.id },
            data: {
              assignedStoreIds: member.assignedStoreIds.filter((id) => !storeIds.includes(id)),
            },
          }),
        ),
      );
    } catch (err) {
      logger.warn(
        `[Stores] Failed to prune assignedStoreIds for org ${sellerId} after deleting ${storeIds.length} store(s).`,
      );
    }

    // Buyer maps hold the marker until told otherwise. A rejected store is
    // already isActive=false so it should not be on one, but a store rejected
    // out of ACTIVE may still be sitting in an open viewport.
    for (const storeId of storeIds) {
      try {
        const location = locations[storeId];
        if (location) {
          emitStoreRemoved(storeId, location.latitude, location.longitude);
        }
      } catch (err) {
        logger.warn(`[Socket] Failed to emit store:removed for deleted store ${storeId}.`);
      }
    }
  }

  static async getStoreById(id: string) {
    const store = await StoreRepository.getStoreById(id);

    if (!store) {
      throw { status: 404, message: 'Store not found.' };
    }

    // Checked independently of isActive: isActive is the seller's own
    // open/closed-for-business toggle (PATCH /stores/:id), so a PENDING or
    // REJECTED store's owner could otherwise self-activate visibility before
    // admin review completes.
    if (store.approvalStatus !== 'ACTIVE') {
      throw { status: 404, message: 'Store not found.' };
    }

    if (!store.isActive) {
      throw { status: 404, message: 'Store is not currently active.' };
    }

    return { ...withPhotoUrls(store), merchantAds: filterLiveAds(store.merchantAds) };
  }

  static async getStoreProducts(storeId: string, limit: number, offset: number) {
    // Verify store exists first
    const store = await StoreRepository.getStoreById(storeId);
    if (!store) throw { status: 404, message: 'Store not found.' };
    if (store.approvalStatus !== 'ACTIVE') {
      throw { status: 404, message: 'Store not found.' };
    }

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
