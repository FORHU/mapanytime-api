import ProductService from '../../src/modules/products/product.service';
import ProductRepository from '../../src/modules/products/product.repository';
import type { OrgContext } from '../../src/modules/organization/orgContext';
import { ALL_SELLER_FEATURES } from '../../src/modules/organization/sellerPermissions.constant';

jest.mock('../../src/modules/products/product.repository');

type SellerRow = Awaited<ReturnType<typeof ProductRepository.getSellerByUserId>>;
type StoreRow = Awaited<ReturnType<typeof ProductRepository.getStoreById>>;
type ProductRow = Awaited<ReturnType<typeof ProductRepository.getMyProducts>>['items'][number];

const mockedRepo = ProductRepository as unknown as {
  getSellerByUserId: jest.Mock<
    Promise<Partial<NonNullable<SellerRow>> | null>,
    Parameters<typeof ProductRepository.getSellerByUserId>
  >;
  getStoreById: jest.Mock<
    Promise<Partial<NonNullable<StoreRow>> | null>,
    Parameters<typeof ProductRepository.getStoreById>
  >;
  getMyProducts: jest.Mock<
    Promise<{ items: Array<Partial<ProductRow>>; total: number }>,
    Parameters<typeof ProductRepository.getMyProducts>
  >;
};

const SELLER = { id: 'seller-1' };
const STORE = { id: 'store-1', sellerId: 'seller-1' };

/** The service takes a resolved org context now, not a user id. */
const admin: OrgContext = {
  organizationId: 'org-1',
  role: 'SELLER_ADMIN',
  isAdmin: true,
  assignedStoreIds: null,
  permissions: [...ALL_SELLER_FEATURES],
};

/**
 * What `resolveStoreScope(admin, 'store-1')` produces: the caller's whole scope
 * intersected with the requested store, never replaced by it.
 */
const SCOPE_FOR_STORE_1 = {
  AND: [{ sellerOrganizationId: 'org-1' }, { id: 'store-1' }],
};

describe('ProductService.getMyProducts — server-side sorting', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRepo.getSellerByUserId.mockResolvedValue(SELLER);
    mockedRepo.getStoreById.mockResolvedValue(STORE);
    mockedRepo.getMyProducts.mockResolvedValue({ items: [], total: 0 });
  });

  const base = { page: 1, limit: 10, skip: 0 };

  it('forwards sortBy/sortOrder to the repository', async () => {
    await ProductService.getMyProducts(admin, 'store-1', {
      ...base,
      sortBy: 'price',
      sortOrder: 'asc',
    });

    // The repository takes (storeScope, opts) now, and the service resolves
    // `categoryId` into a `categoryIds` list before handing it over.
    expect(mockedRepo.getMyProducts).toHaveBeenCalledWith(SCOPE_FOR_STORE_1, {
      skip: 0,
      take: 10,
      search: undefined,
      categoryIds: undefined,
      sortBy: 'price',
      sortOrder: 'asc',
    });
  });

  it('omits sort params when not requested (defaults to createdAt desc in repo)', async () => {
    await ProductService.getMyProducts(admin, 'store-1', base);

    expect(mockedRepo.getMyProducts).toHaveBeenCalledWith(SCOPE_FOR_STORE_1, {
      skip: 0,
      take: 10,
      search: undefined,
      categoryIds: undefined,
      sortBy: undefined,
      sortOrder: undefined,
    });
  });

  it('returns the page envelope built from repo results', async () => {
    mockedRepo.getMyProducts.mockResolvedValue({ items: [{ id: 'p1' }], total: 1 });

    const result = await ProductService.getMyProducts(admin, 'store-1', base);

    expect(result).toMatchObject({
      items: [{ id: 'p1' }],
      total: 1,
      page: 1,
      limit: 10,
      totalPages: 1,
    });
  });

  it('intersects a requested store with the caller scope rather than trusting it', async () => {
    // Replaces the old "rejects with 403 when the seller does not own the
    // store" case. The service no longer performs an ownership check —
    // `requireStoreInScope` refuses an out-of-scope id first (with a 404).
    // What the service still owes us is that a supplied storeId narrows the
    // caller's scope instead of replacing it, so a member cannot read a
    // sibling store's catalogue by naming it.
    const member: OrgContext = {
      organizationId: 'org-1',
      role: 'SELLER_USER',
      isAdmin: false,
      assignedStoreIds: ['store-assigned'],
      permissions: ['products'],
    };

    await ProductService.getMyProducts(member, 'store-not-assigned', base);

    expect(mockedRepo.getMyProducts).toHaveBeenCalledWith(
      {
        AND: [
          { sellerOrganizationId: 'org-1', id: { in: ['store-assigned'] } },
          { id: 'store-not-assigned' },
        ],
      },
      expect.anything(),
    );
  });
});
