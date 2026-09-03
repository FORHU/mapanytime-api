import { Prisma, SellerOrgRole } from '@prisma/client';
import { prisma } from '../../utils/prisma';

export default class OrganizationRepository {
  /**
   * Takes a resolved scope rather than a bare org id: an admin's scope is every
   * store in the organization, a member's is only their assigned stores. Passing
   * just the org id returned all of them to anyone who could call the route.
   */
  static getOrgStores(scope: Prisma.StoresWhereInput) {
    return prisma.stores.findMany({
      where: scope,
      select: { id: true, storeName: true, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  static getMembers(orgId: string) {
    return prisma.sellerOrganizationMembers.findMany({
      where: { sellerOrganizationId: orgId },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
        assignedStores: { select: { storeId: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  static getMemberById(memberId: string) {
    return prisma.sellerOrganizationMembers.findUnique({ where: { id: memberId } });
  }

  static findMembership(orgId: string, userId: string) {
    return prisma.sellerOrganizationMembers.findUnique({
      where: { sellerOrganizationId_userId: { sellerOrganizationId: orgId, userId } },
    });
  }

  static createMember(data: {
    sellerOrganizationId: string;
    userId: string;
    role: SellerOrgRole;
    storeIds: string[];
    permissions: string[];
  }) {
    return prisma.$transaction(async (tx) => {
      const member = await tx.sellerOrganizationMembers.create({
        data: {
          sellerOrganizationId: data.sellerOrganizationId,
          userId: data.userId,
          role: data.role,
          permissions: data.permissions,
        },
      });
      if (data.storeIds.length > 0) {
        await tx.sellerOrganizationMemberStores.createMany({
          data: data.storeIds.map((storeId) => ({ memberId: member.id, storeId })),
        });
      }
      return member;
    });
  }

  static async updateMember(
    memberId: string,
    data: { role?: SellerOrgRole; storeIds?: string[]; permissions?: string[] },
  ) {
    return prisma.$transaction(async (tx) => {
      if (data.role !== undefined || data.permissions !== undefined) {
        await tx.sellerOrganizationMembers.update({
          where: { id: memberId },
          data: {
            ...(data.role !== undefined ? { role: data.role } : {}),
            ...(data.permissions !== undefined ? { permissions: data.permissions } : {}),
          },
        });
      }
      if (data.storeIds !== undefined) {
        await tx.sellerOrganizationMemberStores.deleteMany({ where: { memberId } });
        if (data.storeIds.length > 0) {
          await tx.sellerOrganizationMemberStores.createMany({
            data: data.storeIds.map((storeId) => ({ memberId, storeId })),
          });
        }
      }
      return tx.sellerOrganizationMembers.findUnique({
        where: { id: memberId },
        include: {
          user: { select: { id: true, email: true, firstName: true, lastName: true } },
          assignedStores: { select: { storeId: true } },
        },
      });
    });
  }

  static deleteMember(memberId: string) {
    return prisma.sellerOrganizationMembers.delete({ where: { id: memberId } });
  }

  static findUserByEmail(email: string) {
    return prisma.users.findUnique({
      where: { email },
      select: { id: true, email: true, firstName: true, lastName: true },
    });
  }

  /**
   * Idempotently create a seller organization for a brand-new seller: the org,
   * the seller binding, and the owner's `SELLER_ADMIN` membership. Must run
   * inside the same transaction that creates the seller so the seller always
   * receives `sellerOrganizationId`. Roles are a fixed enum, not rows, so there
   * is nothing else to provision.
   */
  static async ensureSellerOrganization(
    tx: Prisma.TransactionClient,
    input: { sellerId: string; userId: string; orgName: string },
  ) {
    const seller = await tx.sellers.findUnique({ where: { id: input.sellerId } });
    if (!seller) throw new Error(`Seller ${input.sellerId} not found during org creation`);

    const orgId =
      seller.sellerOrganizationId ??
      (
        await tx.sellerOrganizations.create({
          data: { ownerId: input.userId, name: input.orgName },
        })
      ).id;

    if (!seller.sellerOrganizationId) {
      await tx.sellers.update({
        where: { id: input.sellerId },
        data: { sellerOrganizationId: orgId },
      });
    }

    await tx.sellerOrganizationMembers.upsert({
      where: {
        sellerOrganizationId_userId: { sellerOrganizationId: orgId, userId: input.userId },
      },
      update: { role: SellerOrgRole.SELLER_ADMIN },
      create: {
        sellerOrganizationId: orgId,
        userId: input.userId,
        role: SellerOrgRole.SELLER_ADMIN,
      },
    });

    return orgId;
  }
}
