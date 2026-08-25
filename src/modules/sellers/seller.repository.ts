import { ApplicationStatus } from '@prisma/client';
import { prisma } from '../../utils/prisma';

/** Only a PENDING, non-deleted seller is eligible for a review decision. */
const REVIEWABLE = { applicationStatus: ApplicationStatus.PENDING, deletedAt: null } as const;

export default class SellerRepository {
  static async getPendingSellers(limit: number, skip: number) {
    const [sellers, total] = await Promise.all([
      prisma.sellers.findMany({
        where: REVIEWABLE,
        include: {
          users: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              phoneNumber: true,
            },
          },
          // `_count` rather than hydrating the rows: the list only ever renders
          // these as integers, and the previous include pulled every store and
          // every document of every verification for every seller on the page.
          _count: { select: { stores: true, documentVerifications: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip,
      }),
      prisma.sellers.count({ where: REVIEWABLE }),
    ]);

    return { sellers, total };
  }

  static async getSellerById(sellerId: string) {
    // findFirst, not findUnique: a soft-deleted seller must not be readable or
    // actionable through the admin queue.
    return prisma.sellers.findFirst({
      where: { id: sellerId, deletedAt: null },
      include: {
        users: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phoneNumber: true,
          },
        },
        documentVerifications: {
          include: {
            documents: { select: { id: true, documentType: true } },
          },
        },
        stores: {
          select: { id: true, storeName: true, approvalStatus: true },
        },
        reviewedBy: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
      },
    });
  }

  /**
   * Records a review decision only if the seller is still PENDING.
   *
   * The status guard lives in the WHERE clause rather than in a prior read so
   * that two admins acting at once cannot both pass the check — the second
   * update matches zero rows instead of silently overwriting the first
   * decision. Returns the number of rows actually changed.
   */
  static async recordDecision(
    sellerId: string,
    decision: 'APPROVED' | 'REJECTED',
    adminId: string,
    rejectionReason: string | null,
  ) {
    const { count } = await prisma.sellers.updateMany({
      where: { id: sellerId, ...REVIEWABLE },
      data: {
        applicationStatus: decision,
        rejectionReason,
        reviewedAt: new Date(),
        reviewedById: adminId,
      },
    });

    return count;
  }
}
