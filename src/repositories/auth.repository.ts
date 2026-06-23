import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';

export default class AuthRepo {
  static async createUser(data: {
    email: string;
    password?: string;
    name?: string;
  }) {
    const user = await prisma.users.create({
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
    return this.mapUser(user);
  }

  static async findUserByEmail(email: string) {
    const user = await prisma.users.findFirst({
      where: {
        Email: email,
        AccountStatus: 'ACTIVE',
      },
      include: { Avatar: true },
    });
    return user ? this.mapUserWithAvatar(user) : null;
  }

  static async updateUserLoginStatus(userId: string) {
    const user = await prisma.users.update({
      where: { Id: userId },
      data: {
        LastLoginAt: new Date(),
        UpdatedAt: new Date(),
      },
      include: { Avatar: true },
    });
    return this.mapUserWithAvatar(user);
  }

  static async findUserById(userId: string) {
    const user = await prisma.users.findFirst({
      where: { Id: userId, AccountStatus: 'ACTIVE' },
      include: { Avatar: true },
    });
    return user ? this.mapUserWithAvatar(user) : null;
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
      where: {
        RefreshToken: refreshToken,
        ExpiresAt: { gt: new Date() },
      },
      include: { users: true },
    });
  }

  static async deleteSession(refreshToken: string) {
    return prisma.sessionSocialAccount.deleteMany({
      where: { RefreshToken: refreshToken },
    });
  }

  static async updateUser(userId: string, data: Prisma.UsersUncheckedUpdateInput) {
    const user = await prisma.users.update({
      where: { Id: userId },
      data: data,
    });
    return this.mapUser(user);
  }

  static async getAuthUser(userId: string) {
    const user = await prisma.users.findUnique({
      where: { Id: userId },
      include: { Avatar: true },
    });
    return user ? this.mapUserWithAvatar(user) : null;
  }

  // --- Strict PascalCase Helpers ---
  private static mapUser(user: any) {
    return {
      Id: user.Id || user.UserId, 
      Email: user.Email,
      PasswordHash: user.PasswordHash,
      Name: `${user.FirstName || ''} ${user.LastName || ''}`.trim(),
      Role: user.Role,
      IsEmailVerified: user.IsEmailVerified,
      OnboardingCompleted: true, 
      CreatedAt: user.CreatedAt,
      UpdatedAt: user.UpdatedAt,
      IsActive: user.AccountStatus === 'ACTIVE',
    };
  }

  private static mapUserWithAvatar(user: any) {
    const mapped = this.mapUser(user);
    return {
      ...mapped,
      Avatar: user.Avatar ? { FileUrl: user.Avatar.FileUrl } : null,
    };
  }
}