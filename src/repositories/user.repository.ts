import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';

export default class UserRepository {
  /**
   * Find a user by ID
   */
  static async findById(id: string) {
    const user = await prisma.users.findFirst({
      where: { Id: id, AccountStatus: { not: 'DEACTIVATED' } },
    });
    return user ? this.mapUser(user) : null;
  }

  /**
   * Find a user by email
   */
  static async findByEmail(email: string) {
    const user = await prisma.users.findFirst({
      where: { Email: email, AccountStatus: { not: 'DEACTIVATED' } },
    });
    return user ? this.mapUser(user) : null;
  }

  /**
   * Create a new user
   */
  static async create(data: Prisma.UsersUncheckedCreateInput) {
    const user = await prisma.users.create({
      data,
    });
    return this.mapUser(user);
  }

  /**
   * Update user details
   */
  static async update(id: string, data: Prisma.UsersUncheckedUpdateInput) {
    const user = await prisma.users.update({
      where: { Id: id },
      data: { ...data, UpdatedAt: new Date() },
    });
    return this.mapUser(user);
  }

  /**
   * Soft delete a user
   */
  static async softDelete(id: string) {
    const user = await prisma.users.update({
      where: { Id: id },
      data: { AccountStatus: 'DEACTIVATED' },
    });
    return this.mapUser(user);
  }

  /**
   * List all users (paginated)
   */
  static async findAll(page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;
    const [users, total] = await Promise.all([
      prisma.users.findMany({
        where: { AccountStatus: { not: 'DEACTIVATED' } },
        skip,
        take: limit,
        orderBy: { CreatedAt: 'desc' },
      }),
      prisma.users.count({ where: { AccountStatus: { not: 'DEACTIVATED' } } }),
    ]);

    return {
      users: users.map(u => this.mapUser(u)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Strict PascalCase Helper
   */
  private static mapUser(user: any) {
    return {
      Id: user.Id,
      Email: user.Email,
      PasswordHash: user.PasswordHash,
      Name: `${user.FirstName || ''} ${user.LastName || ''}`.trim(),
      Role: user.Role,
      AccountStatus: user.AccountStatus,
      IsEmailVerified: user.IsEmailVerified,
      CreatedAt: user.CreatedAt,
      UpdatedAt: user.UpdatedAt,
    };
  }
}