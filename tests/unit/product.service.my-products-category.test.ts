import ProductService from '../../src/modules/products/product.service';
import ProductRepository from '../../src/modules/products/product.repository';
import CategoryService from '../../src/modules/categories/category.service';

jest.mock('../../src/modules/products/product.repository', () => ({
  __esModule: true,
  default: {
    getSellerByUserId: jest.fn(),
    getStoreById: jest.fn(),
    getMyProducts: jest.fn(),
  },
}));

jest.mock('../../src/modules/categories/category.service', () => ({
  __esModule: true,
  default: { getCategoryDescendantIds: jest.fn() },
}));

jest.mock('../../src/utils/prisma', () => ({ prisma: {} }));

const getSeller = ProductRepository.getSellerByUserId as jest.Mock;
const getMyProducts = ProductRepository.getMyProducts as jest.Mock;
const getDescendants = CategoryService.getCategoryDescendantIds as jest.Mock;

const opts = (overrides: Record<string, unknown> = {}) => ({
  page: 1,
  limit: 20,
  skip: 0,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  getSeller.mockResolvedValue({ id: 'seller-1' });
  getMyProducts.mockResolvedValue({ items: [], total: 0 });
});

describe('ProductService.getMyProducts category filtering', () => {
  it('expands a parent category to its descendants', async () => {
    // The original bug: an exact categoryId match returned zero rows when every
    // product was filed under a child of the selected category.
    getDescendants.mockResolvedValue(['food', 'bakery', 'sourdough']);

    await ProductService.getMyProducts('user-1', undefined, opts({ categoryId: 'food' }));

    expect(getDescendants).toHaveBeenCalledWith('food');
    expect(getMyProducts.mock.calls[0][2].categoryIds).toEqual(['food', 'bakery', 'sourdough']);
  });

  it('still matches a leaf category, which expands to just itself', async () => {
    getDescendants.mockResolvedValue(['sourdough']);

    await ProductService.getMyProducts('user-1', undefined, opts({ categoryId: 'sourdough' }));

    expect(getMyProducts.mock.calls[0][2].categoryIds).toEqual(['sourdough']);
  });

  it('applies no category filter when none is selected', async () => {
    await ProductService.getMyProducts('user-1', undefined, opts());

    expect(getDescendants).not.toHaveBeenCalled();
    expect(getMyProducts.mock.calls[0][2].categoryIds).toBeUndefined();
  });

  it('aggregates across every store when storeId is omitted', async () => {
    await ProductService.getMyProducts('user-1', undefined, opts());

    const [storeId, sellerId] = getMyProducts.mock.calls[0];
    expect(storeId).toBeUndefined();
    expect(sellerId).toBe('seller-1');
  });
});
