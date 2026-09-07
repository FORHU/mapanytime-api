import { Prisma } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import { SYSTEM_ROLES, type SellerOrgRoleName } from '../../constants/roles.constant';

const memberInclude = {
  user: { select: { id: true, email: true, firstName: true, lastName: true } },
} satisfies Prisma.SellerOrganizationMembersInclude;

type MemberRow = Prisma.SellerOrganizationMembersGetPayload<{ include: typeof memberInclude }>;

export function toMemberResponse(member: MemberRow, ownerUserId: string | null = null) {
  return {
    id: member.id,
    sellerId: member.sellerId,
    userId: member.userId,
    role: member.role,
    user: member.user,
    permissions: member.permissions,
    assignedStores: member.assignedStoreIds.map((storeId) => ({ storeId })),
    isOwner: ownerUserId !== null && member.userId === ownerUserId,
  };
}

export default class OrganizationRepository {
  static async getOwnerUserId(orgId: string) {
    const seller = await prisma.sellers.findUnique({
      where: { id: orgId },
      select: { userId: true },
    });
    return seller?.userId ?? null;
  }

  static getOrgStores(scope: Prisma.StoresWhereInput) {
    return prisma.stores.findMany({
      where: scope,
      select: { id: true, storeName: true, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  static getMembers(orgId: string) {
    return prisma.sellerOrganizationMembers.findMany({
      where: { sellerId: orgId },
      include: memberInclude,
      orderBy: { createdAt: 'asc' },
    });
  }

  static getMemberById(memberId: string) {
    return prisma.sellerOrganizationMembers.findUnique({
      where: { id: memberId },
      include: memberInclude,
    });
  }

  static findMembership(orgId: string, userId: string) {
    return prisma.sellerOrganizationMembers.findUnique({
      where: { sellerId_userId: { sellerId: orgId, userId } },
      include: memberInclude,
    });
  }

  /**
   * Store assignments live on the member row as `assignedStoreIds`, so creating
   * a member is a single insert — the transaction the old join table needed is
   * gone.
   */
  static createMember(data: {
    sellerId: string;
    userId: string;
    role: SellerOrgRoleName;
    storeIds: string[];
    permissions: string[];
  }) {
    return prisma.sellerOrganizationMembers.create({
      data: {
        sellerId: data.sellerId,
        userId: data.userId,
        role: data.role,
        permissions: data.permissions,
        assignedStoreIds: data.storeIds,
      },
      include: memberInclude,
    });
  }

  static updateMember(
    memberId: string,
    data: { role?: SellerOrgRoleName; storeIds?: string[]; permissions?: string[] },
  ) {
    return prisma.sellerOrganizationMembers.update({
      where: { id: memberId },
      data: {
        ...(data.role !== undefined ? { role: data.role } : {}),
        ...(data.permissions !== undefined ? { permissions: data.permissions } : {}),
        ...(data.storeIds !== undefined ? { assignedStoreIds: data.storeIds } : {}),
      },
      include: memberInclude,
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
   * Idempotently provision the organization side of a brand-new seller.
   *
   * The `Sellers` row *is* the organization, so there is no org record to create
   * and no binding to write — only the owner's `SELLER_ADMIN` membership and the
   * organization's display name. Returns the organization id, which is the
   * seller id.
   */
  static async ensureSellerOrganization(
    tx: Prisma.TransactionClient,
    input: { sellerId: string; userId: string; orgName: string },
  ) {
    const seller = await tx.sellers.findUnique({ where: { id: input.sellerId } });
    if (!seller) throw new Error(`Seller ${input.sellerId} not found during org creation`);

    if (!seller.organizationName) {
      await tx.sellers.update({
        where: { id: input.sellerId },
        data: { organizationName: input.orgName },
      });
    }

    await tx.sellerOrganizationMembers.upsert({
      where: { sellerId_userId: { sellerId: input.sellerId, userId: input.userId } },
      update: { role: SYSTEM_ROLES.SELLER_ADMIN },
      create: {
        sellerId: input.sellerId,
        userId: input.userId,
        role: SYSTEM_ROLES.SELLER_ADMIN,
      },
    });

    return input.sellerId;
  }
}
