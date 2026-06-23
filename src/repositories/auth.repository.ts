import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';

export default class AuthRepo {
  static async createUser(data: { email: string; password?: string; name?: string }) {
    return prisma.users.create({
      data: {
        Email: data.email,
        PasswordHash: data.password || '',
        FirstName: data.name?.split(' ')[0] || 'Unknown',
        LastName: data.name?.split(' ').slice(1).join(' ') || '',
        IsEmailVerified: true,
        AccountStatus: 'ACTIVE',
      },
      include: { Avatar: true }
    });
  }

  static async findUserByEmail(email: string) {
    return prisma.users.findFirst({
      where: { Email: email, AccountStatus: 'ACTIVE' },
      include: { Avatar: true },
    });
  }

  static async updateUserLoginStatus(userId: string) {
    return prisma.users.update({
      where: { Id: userId },
      data: { LastLoginAt: new Date(), UpdatedAt: new Date() },
      include: { Avatar: true },
    });
  }

  static async findUserById(userId: string) {
    return prisma.users.findFirst({
      where: { Id: userId, AccountStatus: 'ACTIVE' },
      include: { Avatar: true },
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
    return prisma.sessionSocialAccount.create({
      data: {
        UserId: data.userId,
        RefreshToken: data.refreshToken,
        ExpiresAt: data.expiresAt,
        Provider: data.provider || 'local',
        ProviderUserId: data.providerUserId,
        AvatarUrl: data.providerAvatarUrl,
      },
    });
  }

  static async findValidSession(refreshToken: string) {
    return prisma.sessionSocialAccount.findFirst({
      where: { RefreshToken: refreshToken, ExpiresAt: { gt: new Date() } },
      include: { users: true },
    });
  }

  static async deleteSession(refreshToken: string) {
    return prisma.sessionSocialAccount.deleteMany({
      where: { RefreshToken: refreshToken },
    });
  }

  static async updateUser(userId: string, data: Prisma.UsersUncheckedUpdateInput) {
    return prisma.users.update({
      where: { Id: userId },
      data: data,
    });
  }
}