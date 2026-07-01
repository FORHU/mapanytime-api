import CategoryRepository from '../repositories/category.repository';
import { prisma } from '../utils/prisma';

export default class CategoryService {
  static async createCategory(payload: { name: string; description?: string; parentId?: string }) {
    const { name, description, parentId } = payload;

    // Validate Parent Category exists if parentId is provided
    if (parentId) {
      const parentExists = await prisma.categories.findUnique({ where: { id: parentId } });
      if (!parentExists) throw { status: 404, message: 'Parent category not found.' };
    }

    // Create the global category
    return CategoryRepository.createCategory({ name, description, parentId });
  }

  static async listCategories(payload: { parentId?: string }) {
    const { parentId } = payload;

    if (parentId) {
      return CategoryRepository.getSubCategoriesByParentId(parentId);
    }
    return CategoryRepository.getRootCategories();
  }

  static async updateCategory(payload: {
    categoryId: string;
    updateData: { name?: string; description?: string };
  }) {
    const { categoryId, updateData } = payload;

    const categoryExists = await prisma.categories.findUnique({
      where: { id: categoryId },
    });

    if (!categoryExists) throw { status: 404, message: 'Category not found.' };

    return CategoryRepository.updateCategory(categoryId, updateData);
  }

  static async deleteCategory(payload: { categoryId: string }) {
    const { categoryId } = payload;

    const category = await prisma.categories.findUnique({
      where: { id: categoryId },
      include: {
        children: { take: 1 },
        products: { take: 1 },
        stores: { take: 1 },
      },
    });

    if (!category) throw { status: 404, message: 'Category not found.' };

    const hasDependencies =
      category.children.length > 0 || category.products.length > 0 || category.stores.length > 0;

    if (hasDependencies) {
      await CategoryRepository.softDeleteCategory(categoryId);
      return { message: 'Category soft-deleted because it contains existing dependencies.' };
    } else {
      await CategoryRepository.hardDeleteCategory(categoryId);
      return { message: 'Category permanently deleted.' };
    }
  }
}
