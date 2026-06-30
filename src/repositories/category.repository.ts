import { prisma } from '../utils/prisma';

export default class CategoryRepository {
  static async createCategory(data: {
    name: string;
    description?: string;
    requestedById: string;
    storeId: string;
  }) {
    return prisma.categories.create({
      data: {
        name: data.name,
        description: data.description,
        requestedById: data.requestedById,
        storeId: data.storeId,
      },
    });
  }

  // CHANGED: Renamed the method and added the storeId: string parameter
  static async getCategoriesByStoreId(storeId: string) {
    return prisma.categories.findMany({
      where: { storeId: storeId, status: 'APPROVED' },
    });
  }
}
