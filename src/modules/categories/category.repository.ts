import { prisma } from '../../utils/prisma';

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

  static async getRootCategories() {
    return prisma.categories.findMany({
      where: { parentId: null },
      select: {
        id: true,
        name: true,
      },
    });
  }

  static async getSubCategoriesByParentId(parentId: string) {
    return prisma.categories.findMany({
      where: { parentId: parentId },
      include: { parent: true, children: true },
    });
  }

  static async getBranchCategories() {
    return prisma.categories.findMany({
      where: { parentId: { not: null } },
      select: {
        id: true,
        name: true,
        parent: { select: { id: true, name: true } },
      },
    });
  }

  static async getAllCategoryTrees() {
    return prisma.categories.findMany({
      where: { parentId: null },
      select: {
        id: true,
        name: true,
        children: {
          select: {
            id: true,
            name: true,
            children: {
              select: { id: true, name: true },
            },
          },
        },
      },
    });
  }

  static async findById(id: string) {
    return prisma.categories.findUnique({ where: { id } });
  }

  static async findByIdOrName(identifier: string) {
    return prisma.categories.findFirst({
      where: {
        OR: [{ id: identifier }, { name: identifier }],
      },
    });
  }

  static async getDescendantCategoryIds(categoryId: string) {
    const ids = [categoryId];
    let queue = [categoryId];

    while (queue.length > 0) {
      const children = await prisma.categories.findMany({
        where: { parentId: { in: queue } },
        select: { id: true },
      });

      const childIds = children.map((child) => child.id);
      if (childIds.length === 0) break;

      queue = childIds.filter((id) => !ids.includes(id));
      ids.push(...queue);
    }

    return ids;
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
