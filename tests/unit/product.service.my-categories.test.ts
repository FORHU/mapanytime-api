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
    getUsedCategoryCounts: jest.fn(),
  },
}));

jest.mock('../../src/modules/categories/category.service', () => ({
  __esModule: true,
  default: { getAncestorClosure: jest.fn(), getCategoryDescendantIds: jest.fn() },
}));

jest.mock('../../src/utils/prisma', () => ({ prisma: {} }));

const getSeller = ProductRepository.getSellerByUserId as jest.Mock;
const getStore = ProductRepository.getStoreById as jest.Mock;
const getUsedCounts = ProductRepository.getUsedCategoryCounts as jest.Mock;
const getAncestors = CategoryService.getAncestorClosure as jest.Mock;

const counts = (rows: Array<[string, number]>) =>
  rows.map(([categoryId, n]) => ({ categoryId, _count: { _all: n } }));

/**
 * The service takes a resolved org context now, not a user id — it no longer
 * looks a seller up itself. An admin context stands in for "every store in the
 * organization", which is what these tree-shape cases assume.
 */
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
});

describe('ProductService.getMyCategories', () => {
  it('rolls descendant counts up into ancestors that hold no products directly', async () => {
    // Products sit only on the leaf; the root must still report the total, since
    // that is what the filter row "All of Food & Beverage (5)" displays.
    getUsedCounts.mockResolvedValue(counts([['leaf', 5]]));
    getAncestors.mockResolvedValue([
      { id: 'root', name: 'Food & Beverage', parentId: null },
      { id: 'mid', name: 'Bakery', parentId: 'root' },
      { id: 'leaf', name: 'Sourdough', parentId: 'mid' },
    ]);

    const [root] = await ProductService.getMyCategories(admin, undefined);

    expect(root).toMatchObject({ id: 'root', directCount: 0, totalCount: 5 });
    expect(root.children[0]).toMatchObject({ id: 'mid', directCount: 0, totalCount: 5 });
    expect(root.children[0].children[0]).toMatchObject({
      id: 'leaf',
      directCount: 5,
      totalCount: 5,
    });
  });

  it('sums products filed at several depths of one branch', async () => {
    getUsedCounts.mockResolvedValue(
      counts([
        ['root', 2],
        ['leaf', 3],
      ]),
    );
    getAncestors.mockResolvedValue([
      { id: 'root', name: 'Food & Beverage', parentId: null },
      { id: 'leaf', name: 'Bakery', parentId: 'root' },
    ]);

    const [root] = await ProductService.getMyCategories(admin, undefined);

    expect(root).toMatchObject({ directCount: 2, totalCount: 5 });
  });

  it('returns one tree spanning unrelated roots for the All-Stores case', async () => {
    getUsedCounts.mockResolvedValue(
      counts([
        ['bakery', 4],
        ['audio', 1],
      ]),
    );
    getAncestors.mockResolvedValue([
      { id: 'food', name: 'Food & Beverage', parentId: null },
      { id: 'bakery', name: 'Bakery', parentId: 'food' },
      { id: 'elec', name: 'Electronics', parentId: null },
      { id: 'audio', name: 'Audio', parentId: 'elec' },
    ]);

    const roots = await ProductService.getMyCategories(admin, undefined);

    // Sorted by name, so Electronics precedes Food & Beverage.
    expect(roots.map((r) => r.id)).toEqual(['elec', 'food']);
    expect(roots.map((r) => r.totalCount)).toEqual([1, 4]);
  });

  it('sorts siblings by name', async () => {
    getUsedCounts.mockResolvedValue(
      counts([
        ['c', 1],
        ['a', 1],
        ['b', 1],
      ]),
    );
    getAncestors.mockResolvedValue([
      { id: 'root', name: 'Root', parentId: null },
      { id: 'c', name: 'Cocoa', parentId: 'root' },
      { id: 'a', name: 'Apples', parentId: 'root' },
      { id: 'b', name: 'Bread', parentId: 'root' },
    ]);

    const [root] = await ProductService.getMyCategories(admin, undefined);

    expect(root.children.map((child) => child.name)).toEqual(['Apples', 'Bread', 'Cocoa']);
  });

  it('promotes a node to root when its parent is missing rather than dropping it', async () => {
    // A soft-deleted mid-chain category would otherwise orphan the whole branch.
    getUsedCounts.mockResolvedValue(counts([['orphan', 2]]));
    getAncestors.mockResolvedValue([{ id: 'orphan', name: 'Orphan', parentId: 'gone' }]);

    const roots = await ProductService.getMyCategories(admin, undefined);

    expect(roots.map((r) => r.id)).toEqual(['orphan']);
    expect(roots[0].totalCount).toBe(2);
  });

  it('returns an empty array for a seller with no products, without hitting the tree', async () => {
    getUsedCounts.mockResolvedValue([]);

    expect(await ProductService.getMyCategories(admin, undefined)).toEqual([]);
    expect(getAncestors).not.toHaveBeenCalled();
  });

  it('scopes to every store in the organization for an admin when storeId is omitted', async () => {
    getUsedCounts.mockResolvedValue([]);

    await ProductService.getMyCategories(admin, undefined);

    // The repository takes a resolved StoresWhereInput now, not (storeId, sellerId).
    expect(getUsedCounts).toHaveBeenCalledWith({ sellerOrganizationId: 'org-1' });
    expect(getStore).not.toHaveBeenCalled();
  });

  it('scopes a member to their assigned stores only', async () => {
    // Replaces the old "rejects a store the seller does not own" case. The
    // service no longer performs an ownership check at all — refusing a store
    // outside the caller's scope moved to `requireStoreInScope`, which 404s
    // rather than 403s. What the service still owes us is that the query it
    // builds cannot reach an unassigned store, which is what this asserts.
    const member: OrgContext = {
      organizationId: 'org-1',
      role: 'SELLER_USER',
      isAdmin: false,
      assignedStoreIds: ['store-assigned'],
      permissions: ['products'],
    };
    getUsedCounts.mockResolvedValue([]);

    await ProductService.getMyCategories(member, undefined);

    expect(getUsedCounts).toHaveBeenCalledWith({
      sellerOrganizationId: 'org-1',
      id: { in: ['store-assigned'] },
    });
  });

  it('yields an unmatchable scope for a caller with no organization', async () => {
    // Replaces the old "rejects a user who is not a seller" case. That refusal
    // moved to `requireSellerOrg`; the service fails closed instead, building a
    // filter that matches nothing rather than throwing.
    const orphan: OrgContext = {
      organizationId: null,
      role: null,
      isAdmin: false,
      assignedStoreIds: null,
      permissions: [],
    };
    getUsedCounts.mockResolvedValue([]);

    await ProductService.getMyCategories(orphan, undefined);

    expect(getUsedCounts).toHaveBeenCalledWith({ id: { equals: '__NO_SCOPE__' } });
  });
});
