import { Prisma } from '@prisma/client';
import { prisma } from '../../utils/prisma';

export default class FilesRepository {
  static async create(data: Prisma.FilesCreateInput) {
    return prisma.files.create({ data });
  }

  static async findById(id: string) {
    return prisma.files.findUnique({ where: { id } });
  }
}
