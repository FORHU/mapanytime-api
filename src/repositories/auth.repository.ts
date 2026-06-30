import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';

export default class AuthRepo {
  static async createUser(data: Prisma.UsersCreateInput) {
    return prisma.users.create({
      data: {
        ...data,
        isEmailVerified: true,
        accountStatus: 'ACTIVE',
      },
      include: {
        avatar: true,
        roles: true,
        seller: {
          include: { stores: true }, // Fetches the stores array
        },
      },
    });
  }

  static async createSeller(userId: string) {
    return prisma.sellers.create({
      data: { userId },
    });
  }

  static async findUserByEmail(email: string) {
    return prisma.users.findFirst({
      where: { email: email, accountStatus: 'ACTIVE' },
      include: {
        avatar: true,
        roles: true,
        seller: {
          include: { stores: true },
        },
      },
    });
  }

  static async updateUserLoginStatus(userId: string) {
    return prisma.users.update({
      where: { id: userId },
      data: { lastLoginAt: new Date(), updatedAt: new Date() },
      include: {
        avatar: true,
        roles: true,
        seller: {
          include: { stores: true },
        },
      },
    });
  }

  static async findUserById(userId: string) {
    return prisma.users.findFirst({
      where: { id: userId, accountStatus: 'ACTIVE' },
      include: {
        avatar: true,
        roles: true, // Added roles for consistency
        seller: {
          include: { stores: true },
        },
      },
    });
  }

  static async createSession(data: {
    userId: string;
    refreshToken: string;
    expiresAt: Date;
    provider?: string;
    providerUserId?: string;
    providerAvatarUrl?: string;
  }) {
    return prisma.session.create({
      data: {
        userId: data.userId,
        refreshToken: data.refreshToken,
        expiresAt: data.expiresAt,
        provider: data.provider || 'local',
        providerUserId: data.providerUserId,
        avatarUrl: data.providerAvatarUrl,
      },
    });
  }

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

  static async updateUser(userId: string, data: Prisma.UsersUncheckedUpdateInput) {
    return prisma.users.update({
      where: { id: userId },
      data: data,
    });
  }
}
