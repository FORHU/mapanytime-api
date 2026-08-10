import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';

const userInclude = {
  avatarFile: true,
  roles: true,
  seller: {
    include: { stores: true },
  },
} satisfies Prisma.UsersInclude;

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

  static async findUserByEmail(email: string) {
    return prisma.users.findFirst({
      where: { email: email, accountStatus: 'ACTIVE' },
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

  // Sessions are created only via rotateSession() below, which also updates activeSessionId in
  // the same transaction. A bare create would leave the two out of step.

  static async findValidSession(refreshToken: string) {
    return prisma.session.findFirst({
      where: { refreshToken: refreshToken, expiresAt: { gt: new Date() } },
      include: { users: true },
    });
  }

  static async deleteSession(refreshToken: string) {
    return prisma.session.deleteMany({
      where: { refreshToken: refreshToken },
    });
  }

  /**
   * Atomically swaps a user onto a new session and points activeSessionId at it.
   *
   * These three writes must land together. Done piecemeal, a failure partway through leaves the
   * user with their old sessions deleted and no new one to show for it — logged out everywhere
   * by a request that was supposed to log them in.
   *
   * `revokeOtherSessions` is the single-active-device rule and belongs to real logins only.
   * A token refresh passes `replacesRefreshToken` instead so it retires just its own session,
   * otherwise routine refreshes on one device would silently sign the user out on the others.
   */
  static async rotateSession(params: {
    userId: string;
    refreshToken: string;
    expiresAt: Date;
    provider?: string;
    providerUserId?: string;
    providerAvatarUrl?: string;
    revokeOtherSessions?: boolean;
    replacesRefreshToken?: string;
  }) {
    return prisma.$transaction(async (tx) => {
      if (params.revokeOtherSessions) {
        await tx.session.deleteMany({ where: { userId: params.userId } });
      } else if (params.replacesRefreshToken) {
        await tx.session.deleteMany({ where: { refreshToken: params.replacesRefreshToken } });
      }

      const session = await tx.session.create({
        data: {
          userId: params.userId,
          refreshToken: params.refreshToken,
          expiresAt: params.expiresAt,
          provider: params.provider || 'local',
          providerUserId: params.providerUserId,
          avatarUrl: params.providerAvatarUrl,
        },
      });

      await tx.users.update({
        where: { id: params.userId },
        data: { activeSessionId: session.id },
      });

      return session;
    });
  }

  static async updateActiveSession(userId: string, sessionId: string | null) {
    return prisma.users.update({
      where: { id: userId },
      data: { activeSessionId: sessionId },
    });
  }

  static async updateUser(userId: string, data: Prisma.UsersUncheckedUpdateInput) {
    return prisma.users.update({
      where: { id: userId },
      data: data,
    });
  }
}
