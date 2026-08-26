import CategoryRepository from './category.repository';
import { prisma } from '../../utils/prisma';

export default class CategoryService {
  static async createCategory(payload: { name: string; description?: string; parentId?: string }) {
    const { name, description, parentId } = payload;

    if (parentId) {
      const parentExists = await prisma.categories.findUnique({ where: { id: parentId } });
      if (!parentExists) throw { status: 404, message: 'Parent category not found.' };
    }

    return CategoryRepository.createCategory({ name, description, parentId });
  }

  static async listCategories(payload: { parentId?: string }) {
    const { parentId } = payload;

    if (parentId) {
      return CategoryRepository.getSubCategoriesByParentId(parentId);
    }
    return CategoryRepository.getRootCategories();
  }

  static async getVariantSuggestions(categoryId: string) {
    const category = await prisma.categories.findFirst({
      where: { id: categoryId, deletedAt: null },
      select: { id: true },
    });
    if (!category) throw { status: 404, message: 'Category not found.' };

    const closure = await CategoryRepository.getAncestorClosure([categoryId]);
    const rows = await CategoryRepository.getVariantSuggestionsForCategories(
      closure.map((node) => node.id),
    );

    const byId = new Map(closure.map((node) => [node.id, node]));
    const chain: { id: string; name: string }[] = [];
    let cursor = byId.get(categoryId);
    while (cursor) {
      chain.push({ id: cursor.id, name: cursor.name });
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }

    const byCategory = new Map<string, typeof rows>();
    for (const row of rows) {
      const bucket = byCategory.get(row.categoryId) ?? [];
      bucket.push(row);
      byCategory.set(row.categoryId, bucket);
    }

    // Case-insensitive dedupe, nearest category wins — a sub-category that
    // re-declares "Color" keeps its own position rather than the root's.
    const seen = new Set<string>();
    const suggestions: {
      name: string;
      source: 'category' | 'inherited';
      fromCategoryName: string | null;
    }[] = [];

    for (const [depth, node] of chain.entries()) {
      for (const row of byCategory.get(node.id) ?? []) {
        const key = row.name.trim().toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        suggestions.push({
          name: row.name,
          source: depth === 0 ? 'category' : 'inherited',
          fromCategoryName: depth === 0 ? null : node.name,
        });
      }
    }

    return { categoryId, suggestions };
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
        subCategories: { where: { deletedAt: null }, take: 1 },
        products: { take: 1 },
        stores: { take: 1 },
        // `stores` is the M2M relation only. A category can be a store's
        // primaryCategoryId without being in that set, and hard-deleting it then
        // fires the FK's ON DELETE SET NULL and silently nulls the store's
        // primary while its other join rows survive.
        primaryForStores: { take: 1 },
      },
    });

    if (!category) throw { status: 404, message: 'Category not found.' };

    const hasDependencies =
      category.subCategories.length > 0 ||
      category.products.length > 0 ||
      category.stores.length > 0 ||
      category.primaryForStores.length > 0;

    if (hasDependencies) {
      await CategoryRepository.softDeleteCategory(categoryId);
      return { message: 'Category soft-deleted because it contains existing dependencies.' };
    } else {
      await CategoryRepository.hardDeleteCategory(categoryId);
      return { message: 'Category permanently deleted.' };
    }
  }

  static async getAllRootCategories() {
    return CategoryRepository.getRootCategories();
  }

  static async getAllBranchCategories() {
    return CategoryRepository.getBranchCategories();
  }

  static async getAllCategoryTrees() {
    return CategoryRepository.getAllCategoryTrees();
  }

  static async getCategoryDescendantIds(categoryId: string) {
    return CategoryRepository.getDescendantCategoryIds(categoryId);
  }

  static async getAncestorClosure(ids: string[]) {
    if (ids.length === 0) return [];
    return CategoryRepository.getAncestorClosure(ids);
  }
}
