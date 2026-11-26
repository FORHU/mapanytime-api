import { Prisma } from '@prisma/client';
import { prisma } from '../../utils/prisma';

const userInclude = {
  avatarFile: true,
  roles: true,
  seller: {
    include: { stores: true },
  },
  // No include: `role`, `permissions` and `assignedStoreIds` are all scalar
  // columns on the membership row, so everything `resolveOrgContext` and
  // `requireSellerFeature` need arrives with the row. Both run on every seller
  // request and stay query-free by construction rather than by care.
  orgMemberships: true,
} satisfies Prisma.UsersInclude;

export type AuthUser = Prisma.UsersGetPayload<{ include: typeof userInclude }>;

export default class AuthRepo {
  static async createUser(data: Prisma.UsersCreateInput) {
    return prisma.users.create({
      data: {
        ...data,
        isEmailVerified: true,
        accountStatus: 'ACTIVE',
      },
      include: userInclude,
    });
  }

  static async createSeller(userId: string) {
    return prisma.sellers.create({
      data: { userId },
    });
  }

  static async createBuyer(userId: string, displayName: string) {
    return prisma.buyers.create({
      data: {
        userId: userId,
        displayName: displayName,
      },
    });
  }

  /**
   * Email addresses are not case-sensitive in practice, so neither is this lookup.
   * A case-sensitive match meant someone who registered as `Bob@x.com` could not sign
   * in as `bob@x.com`, and let registration mint a second account differing only by
   * case — which the `@unique` constraint does not prevent.
   *
   * Callers should still normalise on the way in (the login schema lowercases); this
   * is the safety net for rows written before that.
   */
  static async findUserByEmail(email: string) {
    return prisma.users.findFirst({
      where: {
        email: { equals: email, mode: 'insensitive' },
        accountStatus: 'ACTIVE',
      },
      include: userInclude,
    });
  }

  static async updateUserLoginStatus(userId: string) {
    return prisma.users.update({
      where: { id: userId },
      data: { lastLoginAt: new Date(), updatedAt: new Date() },
      include: userInclude,
    });
  }

  static async findUserById(userId: string) {
    return prisma.users.findFirst({
      where: { id: userId, accountStatus: 'ACTIVE' },
      include: userInclude,
    });
  }

  static async updateUser(userId: string, data: Prisma.UsersUncheckedUpdateInput) {
    return prisma.users.update({
      where: { id: userId },
      data: data,
    });
  }
}
