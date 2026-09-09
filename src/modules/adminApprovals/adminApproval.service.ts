import { PROPERTYSTATUS } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import StoreApprovalService, { isClaimStale } from './storeApproval.service';

/**
 * The vocabulary the admin queue speaks, across both entity types.
 *
 * `DRAFT` exists here because properties have one and stores do not. It used to
 * be folded into PENDING, which put listings the seller had not submitted yet
 * into the review queue looking identical to ones actually waiting on an admin.
 */
export type ApprovalStatus =
  'DRAFT' | 'PENDING' | 'UNDER_REVIEW' | 'NEEDS_REVISION' | 'ACTIVE' | 'REJECTED';

/**
 * Properties have no reviewer-claim concept, so `PENDING_REVIEW` maps to
 * PENDING (waiting, unclaimed) rather than UNDER_REVIEW — nobody has picked it
 * up, and saying otherwise would hide it from the queue an admin works from.
 */
const PROPERTY_STATUS_MAP: Record<PROPERTYSTATUS, ApprovalStatus> = {
  [PROPERTYSTATUS.DRAFT]: 'DRAFT',
  [PROPERTYSTATUS.PENDING_REVIEW]: 'PENDING',
  [PROPERTYSTATUS.ACTIVE]: 'ACTIVE',
  [PROPERTYSTATUS.REJECTED]: 'REJECTED',
};

export default class AdminApprovalService {
  static async listApprovals() {
    const [stores, properties] = await Promise.all([
      prisma.stores.findMany({
        where: { deletedAt: null },
        include: {
          seller: { include: { users: true } },
          storeLocations: true,
          reviewClaimedBy: { select: { id: true, firstName: true, lastName: true } },
        },
        // Queue order follows the most recent submission, so a store that has
        // been through a revision round takes its new place in line rather than
        // keeping its original one.
        //
        // `nulls: 'last'` because Postgres sorts NULLs first on DESC, which
        // would float every row without a submission date — seeded fixtures,
        // and anything the backfill missed — above real submissions.
        orderBy: [{ lastSubmittedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      }),
      prisma.productProperties.findMany({
        include: {
          store: {
            include: {
              seller: { include: { users: true } },
            },
          },
          propertyFiles: {
            include: {
              file: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return [
      ...stores.map((store) => ({
        id: store.id,
        entityType: 'STORE' as const,
        name: store.storeName,
        owner: `${store.seller.users.firstName ?? ''} ${store.seller.users.lastName ?? ''}`.trim(),
        email: store.seller.users.email,
        address: store.storeLocations?.currentAddress ?? '',
        city: store.storeLocations?.city ?? null,
        province: store.storeLocations?.province ?? null,
        propertyType: null,
        status: store.approvalStatus as ApprovalStatus,
        rejectionReason: store.rejectionReason,
        revisionNotes: store.revisionNotes,
        // A claim nobody has acted on for a day is reported as released, so the
        // store returns to the workable queue without a scheduled job and
        // without the status column lying about where it is.
        claimedBy:
          store.reviewClaimedBy && !isClaimStale(store.reviewClaimedAt)
            ? {
                id: store.reviewClaimedBy.id,
                name:
                  `${store.reviewClaimedBy.firstName ?? ''} ${store.reviewClaimedBy.lastName ?? ''}`.trim() ||
                  'Unknown admin',
              }
            : null,
        claimedAt: isClaimStale(store.reviewClaimedAt) ? null : store.reviewClaimedAt,
        submittedAt: store.lastSubmittedAt ?? store.createdAt,
        createdAt: store.createdAt,
      })),
      ...properties.map((property) => ({
        id: property.id,
        entityType: 'PROPERTY' as const,
        name: property.propertyType === 'HOUSE_LOT' ? 'House & Lot' : 'Raw Land',
        owner: property.legalName,
        email: property.store.seller.users.email,
        address: property.address,
        city: null,
        province: null,
        propertyType: property.propertyType,
        status: PROPERTY_STATUS_MAP[property.status],
        rejectionReason: property.rejectionReason,
        revisionNotes: null,
        // Properties are reviewed without the claim workflow, so these are
        // always null rather than absent — the admin table renders one shape.
        claimedBy: null,
        claimedAt: null,
        submittedAt: property.createdAt,
        createdAt: property.createdAt,
      })),
    ];
  }

  static async approveProperty(propertyId: string, adminId: string) {
    const property = await prisma.productProperties.findUnique({ where: { id: propertyId } });
    if (!property) throw { status: 404, message: 'Property not found.' };

    return prisma.productProperties.update({
      where: { id: propertyId },
      data: {
        status: PROPERTYSTATUS.ACTIVE,
        rejectionReason: null,
        reviewedAt: new Date(),
        reviewedById: adminId,
      },
    });
  }

  static async rejectProperty(propertyId: string, adminId: string, reason: string) {
    const property = await prisma.productProperties.findUnique({ where: { id: propertyId } });
    if (!property) throw { status: 404, message: 'Property not found.' };

    return prisma.productProperties.update({
      where: { id: propertyId },
      data: {
        status: PROPERTYSTATUS.REJECTED,
        rejectionReason: reason,
        reviewedAt: new Date(),
        reviewedById: adminId,
      },
    });
  }

  /**
   * Store decisions all delegate to `StoreApprovalService`, which owns the
   * transition matrix, the compare-and-set write and the audit entry. These
   * wrappers exist so the controller keeps one service to talk to.
   */
  static approveStore(storeId: string, adminId: string) {
    return StoreApprovalService.approve(storeId, adminId);
  }

  static rejectStore(storeId: string, adminId: string, reason: string) {
    return StoreApprovalService.reject(storeId, adminId, reason);
  }

  static requestStoreRevision(storeId: string, adminId: string, notes: string) {
    return StoreApprovalService.requestRevision(storeId, adminId, notes);
  }

  static claimStore(storeId: string, adminId: string, force = false) {
    return StoreApprovalService.claim(storeId, adminId, force);
  }

  static releaseStore(storeId: string, adminId: string) {
    return StoreApprovalService.release(storeId, adminId);
  }

  static getStoreHistory(storeId: string) {
    return StoreApprovalService.getHistory(storeId);
  }
}
