import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';

export default class UserRepository {
  static async findById(id: string) {
    return prisma.users.findFirst({
      where: { Id: id, AccountStatus: { not: 'DEACTIVATED' } },
    });
  }

  static async findByEmail(email: string) {
    return prisma.users.findFirst({
      where: { Email: email, AccountStatus: { not: 'DEACTIVATED' } },
    });
  }

  static async create(data: Prisma.UsersUncheckedCreateInput) {
    return prisma.users.create({ data });
  }

  static async update(id: string, data: Prisma.UsersUncheckedUpdateInput) {
    return prisma.users.update({
      where: { Id: id },
      data: { ...data, UpdatedAt: new Date() },
    });
  }

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
    return { users, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}