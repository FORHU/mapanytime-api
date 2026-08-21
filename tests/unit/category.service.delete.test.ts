import CategoryService from '../../src/modules/categories/category.service';
import CategoryRepository from '../../src/modules/categories/category.repository';
import { prisma } from '../../src/utils/prisma';

jest.mock('../../src/modules/categories/category.repository', () => ({
  __esModule: true,
  default: { softDeleteCategory: jest.fn(), hardDeleteCategory: jest.fn() },
}));

jest.mock('../../src/utils/prisma', () => ({
  prisma: { categories: { findUnique: jest.fn() } },
}));

const findCategory = prisma.categories.findUnique as unknown as jest.Mock;
const softDelete = CategoryRepository.softDeleteCategory as jest.Mock;
const hardDelete = CategoryRepository.hardDeleteCategory as jest.Mock;

/** A dependency-free category, overridden per test. */
const category = (overrides: Record<string, unknown> = {}) => ({
  id: 'cat-B',
  subCategories: [],
  products: [],
  stores: [],
  primaryForStores: [],
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('CategoryService.deleteCategory', () => {
  it('soft-deletes a category that is a store primary but in no store M2M set', async () => {
    // The state that used to slip through: `stores` (the M2M) is empty, so the
    // category looked unused and was hard-deleted, and the FK's ON DELETE SET
    // NULL then nulled the store's primaryCategoryId.
    findCategory.mockResolvedValue(category({ primaryForStores: [{ id: 'store-1' }] }));

    const result = await CategoryService.deleteCategory({ categoryId: 'cat-B' });

    expect(softDelete).toHaveBeenCalledWith('cat-B');
    expect(hardDelete).not.toHaveBeenCalled();
    expect(result.message).toMatch(/soft-deleted/);
  });

  it('still hard-deletes a category with no dependencies at all', async () => {
    findCategory.mockResolvedValue(category());

    await CategoryService.deleteCategory({ categoryId: 'cat-B' });

    expect(hardDelete).toHaveBeenCalledWith('cat-B');
    expect(softDelete).not.toHaveBeenCalled();
  });

  it('queries the primary-category back-relation alongside the M2M', async () => {
    findCategory.mockResolvedValue(category());

    await CategoryService.deleteCategory({ categoryId: 'cat-B' });

    const { include } = findCategory.mock.calls[0][0];
    expect(include.primaryForStores).toEqual({ take: 1 });
    expect(include.stores).toEqual({ take: 1 });
  });

  it('throws 404 when the category does not exist', async () => {
    findCategory.mockResolvedValue(null);

    await expect(CategoryService.deleteCategory({ categoryId: 'missing' })).rejects.toEqual({
      status: 404,
      message: 'Category not found.',
    });
  });
});
