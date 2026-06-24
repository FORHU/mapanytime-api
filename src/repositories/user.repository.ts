import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';

export default class UserRepository {
  static async findById(id: string) {
    return prisma.users.findFirst({
      where: { id: id, accountStatus: { not: 'DEACTIVATED' } },
    });
  }

  static async findByEmail(email: string) {
    return prisma.users.findFirst({
      where: { email: email, accountStatus: { not: 'DEACTIVATED' } },
    });
  }

  static async create(data: Prisma.UsersUncheckedCreateInput) {
    return prisma.users.create({ data });
  }

  static async update(id: string, data: Prisma.UsersUncheckedUpdateInput) {
    return prisma.users.update({
      where: { id: id },
      data: { ...data, updatedAt: new Date() },
    });
  }

  static async findAll(page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;
    const [users, total] = await Promise.all([
      prisma.users.findMany({
        where: { accountStatus: { not: 'DEACTIVATED' } },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.users.count({ where: { accountStatus: { not: 'DEACTIVATED' } } }),
    ]);
    return { users, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}