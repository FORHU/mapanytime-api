import ProductService from '../../src/modules/products/product.service';
import ProductRepository from '../../src/modules/products/product.repository';
import type { OrgContext } from '../../src/modules/organization/orgContext';

jest.mock('../../src/modules/products/product.repository', () => ({
  __esModule: true,
  default: { getMyProducts: jest.fn(), getUsedCategoryCounts: jest.fn() },
}));

jest.mock('../../src/utils/prisma', () => ({ prisma: {} }));

const getMyProducts = ProductRepository.getMyProducts as jest.Mock;

const opts = { page: 1, limit: 20, skip: 0 };

const admin: OrgContext = {
  organizationId: 'org-1',
  role: 'SELLER_ADMIN',
  isAdmin: true,
  assignedStoreIds: null,
  permissions: ['orders', 'products', 'promotions', 'sales_review', 'customer_review'],
};

const member: OrgContext = {
  organizationId: 'org-1',
  role: 'SELLER_USER',
  isAdmin: false,
  assignedStoreIds: ['store-assigned'],
  permissions: ['orders', 'products'],
};

/** The `StoresWhereInput` the service handed the repository. */
const scopeUsed = () => getMyProducts.mock.calls[0][0];

beforeEach(() => {
  jest.clearAllMocks();
  getMyProducts.mockResolvedValue({ items: [], total: 0 });
});

describe('ProductService.getMyProducts store scoping', () => {
  it('covers every org store for an admin in All-Stores mode', async () => {
    await ProductService.getMyProducts(admin, undefined, opts);

    expect(scopeUsed()).toEqual({ sellerOrganizationId: 'org-1' });
  });

  it('covers only assigned stores for a member in All-Stores mode', async () => {
    await ProductService.getMyProducts(member, undefined, opts);

    expect(scopeUsed()).toEqual({
      sellerOrganizationId: 'org-1',
      id: { in: ['store-assigned'] },
    });
  });

  it('narrows to the requested store without dropping the assignment filter', async () => {
    // The regression this guards: a supplied storeId used to REPLACE the scope
    // with `{ id, sellerOrganizationId }`, so a seller_user could read any
    // sibling store's products by passing its id. The store filter must be
    // intersected with the context scope, never substituted for it.
    await ProductService.getMyProducts(member, 'store-not-assigned', opts);

    expect(scopeUsed()).toEqual({
      AND: [
        { sellerOrganizationId: 'org-1', id: { in: ['store-assigned'] } },
        { id: 'store-not-assigned' },
      ],
    });
  });

  it('yields an unmatchable scope when the caller has no organization', async () => {
    const orphan: OrgContext = {
      organizationId: null,
      role: null,
      isAdmin: false,
      assignedStoreIds: null,
      permissions: [],
    };

    await ProductService.getMyProducts(orphan, 'store-assigned', opts);

    expect(scopeUsed()).toEqual({
      AND: [{ id: { equals: '__NO_SCOPE__' } }, { id: 'store-assigned' }],
    });
  });

  it('matches nothing for a member with no stores assigned yet', async () => {
    // The state an invited member lands in: a membership row, zero assignments.
    const unassigned: OrgContext = { ...member, assignedStoreIds: [] };

    await ProductService.getMyProducts(unassigned, undefined, opts);

    expect(scopeUsed()).toEqual({
      sellerOrganizationId: 'org-1',
      id: { in: ['__NONE__'] },
    });
  });
});
