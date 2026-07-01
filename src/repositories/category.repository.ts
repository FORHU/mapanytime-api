import { prisma } from '../utils/prisma';

export default class CategoryRepository {
  static async createCategory(data: { name: string; description?: string; parentId?: string }) {
    return prisma.categories.create({
      data: {
        name: data.name,
        description: data.description,
        parentId: data.parentId || null,
      },
    });
  }

  // Fetch root categories (Generic Store Categories)
  static async getRootCategories() {
    return prisma.categories.findMany({
      where: { parentId: null },
      include: { children: true },
    });
  }

  // Fetch sub-categories based on a specific parent category
  static async getSubCategoriesByParentId(parentId: string) {
    return prisma.categories.findMany({
      where: { parentId: parentId },
    });
  }

  static async updateCategory(
    id: string,
    data: { name?: string; description?: string; isActive?: boolean },
  ) {
    return prisma.categories.update({
      where: { id },
      data,
    });
  }

  static async softDeleteCategory(id: string) {
    return prisma.categories.update({
      where: { id },
      data: { isActive: false },
    });
  }

  static async hardDeleteCategory(id: string) {
    return prisma.categories.delete({
      where: { id },
    });
  }
}
