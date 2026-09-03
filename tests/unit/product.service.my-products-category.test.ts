import ProductService from '../../src/modules/products/product.service';
import ProductRepository from '../../src/modules/products/product.repository';
import CategoryService from '../../src/modules/categories/category.service';
import type { OrgContext } from '../../src/modules/organization/orgContext';
import { ALL_SELLER_FEATURES } from '../../src/modules/organization/sellerPermissions.constant';

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

/** The service takes a resolved org context now, not a user id. */
const admin: OrgContext = {
  organizationId: 'org-1',
  role: 'SELLER_ADMIN',
  isAdmin: true,
  assignedStoreIds: null,
  permissions: [...ALL_SELLER_FEATURES],
};

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

    await ProductService.getMyProducts(admin, undefined, opts({ categoryId: 'food' }));

    expect(getDescendants).toHaveBeenCalledWith('food');
    expect(getMyProducts.mock.calls[0][1].categoryIds).toEqual(['food', 'bakery', 'sourdough']);
  });

  it('still matches a leaf category, which expands to just itself', async () => {
    getDescendants.mockResolvedValue(['sourdough']);

    await ProductService.getMyProducts(admin, undefined, opts({ categoryId: 'sourdough' }));

    expect(getMyProducts.mock.calls[0][1].categoryIds).toEqual(['sourdough']);
  });

  it('applies no category filter when none is selected', async () => {
    await ProductService.getMyProducts(admin, undefined, opts());

    expect(getDescendants).not.toHaveBeenCalled();
    expect(getMyProducts.mock.calls[0][1].categoryIds).toBeUndefined();
  });

  it('aggregates across every store when storeId is omitted', async () => {
    await ProductService.getMyProducts(admin, undefined, opts());

    // The repository takes one resolved StoresWhereInput now — the old
    // (storeId, sellerId, opts) triple is gone, so "all stores" is expressed as
    // an org-wide scope rather than an undefined store id.
    const [storeScope] = getMyProducts.mock.calls[0];
    expect(storeScope).toEqual({ sellerOrganizationId: 'org-1' });
  });
});
