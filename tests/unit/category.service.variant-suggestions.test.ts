import CategoryService from '../../src/modules/categories/category.service';
import CategoryRepository from '../../src/modules/categories/category.repository';
import { prisma } from '../../src/utils/prisma';

jest.mock('../../src/modules/categories/category.repository');
jest.mock('../../src/utils/prisma', () => ({
  prisma: { categories: { findFirst: jest.fn() } },
}));

const mockedPrisma = prisma as unknown as { categories: { findFirst: jest.Mock } };
const mockedRepo = CategoryRepository as jest.Mocked<typeof CategoryRepository>;

// Shopping & Retail (root) → Fashion (leaf). The real seeded shape.
const ROOT = { id: 'root-1', name: 'Shopping & Retail', parentId: null };
const LEAF = { id: 'leaf-1', name: 'Fashion', parentId: 'root-1' };

beforeEach(() => {
  jest.clearAllMocks();
  mockedPrisma.categories.findFirst.mockResolvedValue({ id: LEAF.id });
  (mockedRepo.getAncestorClosure as jest.Mock).mockResolvedValue([LEAF, ROOT]);
});

describe('getVariantSuggestions — inheritance', () => {
  it("lists the category's own suggestions before the ancestors' ", async () => {
    (mockedRepo.getVariantSuggestionsForCategories as jest.Mock).mockResolvedValue([
      { categoryId: ROOT.id, name: 'Brand', position: 0 },
      { categoryId: LEAF.id, name: 'Size', position: 0 },
      { categoryId: LEAF.id, name: 'Color', position: 1 },
    ]);

    const { suggestions } = await CategoryService.getVariantSuggestions(LEAF.id);

    expect(suggestions.map((s) => s.name)).toEqual(['Size', 'Color', 'Brand']);
  });

  it('marks the source of each suggestion', async () => {
    (mockedRepo.getVariantSuggestionsForCategories as jest.Mock).mockResolvedValue([
      { categoryId: LEAF.id, name: 'Size', position: 0 },
      { categoryId: ROOT.id, name: 'Brand', position: 0 },
    ]);

    const { suggestions } = await CategoryService.getVariantSuggestions(LEAF.id);

    expect(suggestions).toEqual([
      { name: 'Size', source: 'category', fromCategoryName: null },
      { name: 'Brand', source: 'inherited', fromCategoryName: 'Shopping & Retail' },
    ]);
  });

  it('lets a sub-category override an inherited name, keeping its own position', async () => {
    (mockedRepo.getVariantSuggestionsForCategories as jest.Mock).mockResolvedValue([
      { categoryId: ROOT.id, name: 'Color', position: 0 },
      { categoryId: LEAF.id, name: 'Size', position: 0 },
      { categoryId: LEAF.id, name: 'color', position: 1 },
    ]);

    const { suggestions } = await CategoryService.getVariantSuggestions(LEAF.id);

    // The leaf's own "color" wins over the root's "Color", and stays at its own
    // position rather than being hoisted to the root's.
    expect(suggestions).toEqual([
      { name: 'Size', source: 'category', fromCategoryName: null },
      { name: 'color', source: 'category', fromCategoryName: null },
    ]);
  });

  it('uses getAncestorClosure rather than a hand-rolled single parent hop', async () => {
    (mockedRepo.getVariantSuggestionsForCategories as jest.Mock).mockResolvedValue([]);

    await CategoryService.getVariantSuggestions(LEAF.id);

    expect(mockedRepo.getAncestorClosure).toHaveBeenCalledWith([LEAF.id]);
  });
});

describe('getVariantSuggestions — empty and missing', () => {
  it('returns an empty list rather than throwing when nothing is configured', async () => {
    // The common case: most categories have no suggestions. A throw here would
    // put the seller form into an error state.
    (mockedRepo.getVariantSuggestionsForCategories as jest.Mock).mockResolvedValue([]);

    await expect(CategoryService.getVariantSuggestions(LEAF.id)).resolves.toEqual({
      categoryId: LEAF.id,
      suggestions: [],
    });
  });

  it('404s on an unknown or soft-deleted category', async () => {
    mockedPrisma.categories.findFirst.mockResolvedValue(null);

    await expect(CategoryService.getVariantSuggestions('nope')).rejects.toMatchObject({
      status: 404,
    });
  });
});
