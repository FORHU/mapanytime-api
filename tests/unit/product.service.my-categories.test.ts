import ProductService from '../../src/modules/products/product.service';
import ProductRepository from '../../src/modules/products/product.repository';
import CategoryService from '../../src/modules/categories/category.service';

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

    const [root] = await ProductService.getMyCategories('user-1', undefined);

    expect(root).toMatchObject({ id: 'root', directCount: 0, totalCount: 5 });
    expect(root.children[0]).toMatchObject({ id: 'mid', directCount: 0, totalCount: 5 });
    expect(root.children[0].children[0]).toMatchObject({
      id: 'leaf',
      directCount: 5,
      totalCount: 5,
    });
  });

  it('sums products filed at several depths of one branch', async () => {
    getUsedCounts.mockResolvedValue(counts([['root', 2], ['leaf', 3]]));
    getAncestors.mockResolvedValue([
      { id: 'root', name: 'Food & Beverage', parentId: null },
      { id: 'leaf', name: 'Bakery', parentId: 'root' },
    ]);

    const [root] = await ProductService.getMyCategories('user-1', undefined);

    expect(root).toMatchObject({ directCount: 2, totalCount: 5 });
  });

  it('returns one tree spanning unrelated roots for the All-Stores case', async () => {
    getUsedCounts.mockResolvedValue(counts([['bakery', 4], ['audio', 1]]));
    getAncestors.mockResolvedValue([
      { id: 'food', name: 'Food & Beverage', parentId: null },
      { id: 'bakery', name: 'Bakery', parentId: 'food' },
      { id: 'elec', name: 'Electronics', parentId: null },
      { id: 'audio', name: 'Audio', parentId: 'elec' },
    ]);

    const roots = await ProductService.getMyCategories('user-1', undefined);

    // Sorted by name, so Electronics precedes Food & Beverage.
    expect(roots.map((r) => r.id)).toEqual(['elec', 'food']);
    expect(roots.map((r) => r.totalCount)).toEqual([1, 4]);
  });

  it('sorts siblings by name', async () => {
    getUsedCounts.mockResolvedValue(counts([['c', 1], ['a', 1], ['b', 1]]));
    getAncestors.mockResolvedValue([
      { id: 'root', name: 'Root', parentId: null },
      { id: 'c', name: 'Cocoa', parentId: 'root' },
      { id: 'a', name: 'Apples', parentId: 'root' },
      { id: 'b', name: 'Bread', parentId: 'root' },
    ]);

    const [root] = await ProductService.getMyCategories('user-1', undefined);

    expect(root.children.map((child) => child.name)).toEqual(['Apples', 'Bread', 'Cocoa']);
  });

  it('promotes a node to root when its parent is missing rather than dropping it', async () => {
    // A soft-deleted mid-chain category would otherwise orphan the whole branch.
    getUsedCounts.mockResolvedValue(counts([['orphan', 2]]));
    getAncestors.mockResolvedValue([{ id: 'orphan', name: 'Orphan', parentId: 'gone' }]);

    const roots = await ProductService.getMyCategories('user-1', undefined);

    expect(roots.map((r) => r.id)).toEqual(['orphan']);
    expect(roots[0].totalCount).toBe(2);
  });

  it('returns an empty array for a seller with no products, without hitting the tree', async () => {
    getUsedCounts.mockResolvedValue([]);

    expect(await ProductService.getMyCategories('user-1', undefined)).toEqual([]);
    expect(getAncestors).not.toHaveBeenCalled();
  });

  it('scopes to all of the seller stores when storeId is omitted', async () => {
    getUsedCounts.mockResolvedValue([]);

    await ProductService.getMyCategories('user-1', undefined);

    expect(getUsedCounts).toHaveBeenCalledWith(undefined, 'seller-1');
    expect(getStore).not.toHaveBeenCalled();
  });

  it('rejects a store the seller does not own', async () => {
    getStore.mockResolvedValue({ id: 'store-9', sellerId: 'someone-else' });

    await expect(ProductService.getMyCategories('user-1', 'store-9')).rejects.toEqual({
      status: 403,
      message: 'You do not own this store.',
    });
    expect(getUsedCounts).not.toHaveBeenCalled();
  });

  it('rejects a user who is not a seller', async () => {
    getSeller.mockResolvedValue(null);

    await expect(ProductService.getMyCategories('user-1', undefined)).rejects.toEqual({
      status: 403,
      message: 'Only sellers can view store products.',
    });
  });
});
