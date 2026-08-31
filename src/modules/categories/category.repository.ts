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
      where: { parentId: null, deletedAt: null },
      select: {
        id: true,
        name: true,
      },
    });
  }

  /*
   Only return active subcategories so the category picker and backend validation agree on whether a category is a final/leaf category.
   */
  static async getSubCategoriesByParentId(parentId: string) {
    return prisma.categories.findMany({
      where: { parentId, deletedAt: null },
      include: {
        parent: true,
        subCategories: { where: { deletedAt: null } },
      },
    });
  }

  static async getBranchCategories() {
    return prisma.categories.findMany({
      where: { parentId: { not: null }, deletedAt: null },
      select: {
        id: true,
        name: true,
        parent: { select: { id: true, name: true } },
      },
    });
  }

  static async getAllCategoryTrees() {
    const rows = await prisma.categories.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, parentId: true },
      orderBy: { name: 'asc' },
    });

    type TreeNode = { id: string; name: string; subCategories: TreeNode[] };
    const byId = new Map<string, TreeNode>(
      rows.map((row) => [row.id, { id: row.id, name: row.name, subCategories: [] }]),
    );

    const roots: TreeNode[] = [];
    for (const row of rows) {
      const node = byId.get(row.id)!;
      const parent = row.parentId ? byId.get(row.parentId) : undefined;
      if (parent) parent.subCategories.push(node);
      else roots.push(node);
    }

    return roots;
  }

  static async findById(id: string) {
    return prisma.categories.findUnique({ where: { id } });
  }

  static async findByIdOrName(identifier: string) {
    return prisma.categories.findFirst({
      where: {
        OR: [{ id: identifier }, { name: identifier }],
        deletedAt: null,
      },
    });
  }

  static async getDescendantCategoryIds(categoryId: string) {
    const ids = [categoryId];
    let queue = [categoryId];

    while (queue.length > 0) {
      const children = await prisma.categories.findMany({
        where: { parentId: { in: queue }, deletedAt: null },
        select: { id: true },
      });

      const childIds = children.map((child) => child.id);
      if (childIds.length === 0) break;

      queue = childIds.filter((id) => !ids.includes(id));
      ids.push(...queue);
    }

    return ids;
  }

  /**
   * Upward mirror of `getDescendantCategoryIds`: given a set of category ids,
   * returns those categories plus every ancestor above them.
   *
   * Products only ever sit on the categories a seller picked (typically leaves),
   * but a filter has to render their parents as group headers — so the pruned
   * tree needs the ancestors even though no product references them directly.
   */
  static async getAncestorClosure(ids: string[]) {
    const seen = new Map<string, { id: string; name: string; parentId: string | null }>();
    let queue = [...new Set(ids)];

    while (queue.length > 0) {
      const nodes = await prisma.categories.findMany({
        where: { id: { in: queue }, deletedAt: null },
        select: { id: true, name: true, parentId: true },
      });

      for (const node of nodes) seen.set(node.id, node);

      // Follow parents we haven't resolved yet. Filtering on `seen` also breaks
      // out of any accidental parent cycle.
      queue = [
        ...new Set(
          nodes
            .map((node) => node.parentId)
            .filter((parentId): parentId is string => Boolean(parentId) && !seen.has(parentId!)),
        ),
      ];
    }

    return [...seen.values()];
  }

  static async getVariantSuggestionsForCategories(categoryIds: string[]) {
    if (categoryIds.length === 0) return [];

    return prisma.categoryVariantSuggestions.findMany({
      where: { categoryId: { in: categoryIds } },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      select: { categoryId: true, name: true, position: true },
    });
  }

  static async updateCategory(id: string, data: { name?: string; description?: string }) {
    return prisma.categories.update({
      where: { id },
      data,
    });
  }

  static async softDeleteCategory(id: string) {
    return prisma.categories.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  static async hardDeleteCategory(id: string) {
    return prisma.categories.delete({
      where: { id },
    });
  }
}
