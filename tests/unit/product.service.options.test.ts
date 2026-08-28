import ProductService from '../../src/modules/products/product.service';
import ProductRepository from '../../src/modules/products/product.repository';
import InventoryRepository from '../../src/modules/inventory/inventory.repository';
import { prisma } from '../../src/utils/prisma';

jest.mock('../../src/modules/products/product.repository');
jest.mock('../../src/modules/inventory/inventory.repository');

/**
 * The transaction client handed to the callback. Kept as a distinct object from
 * `prisma` so the tests can assert the repository was given THIS one — passing
 * the global client instead type-checks fine and silently runs the create
 * outside the transaction.
 */
const txMock = {
  inventory: { create: jest.fn() },
  productImages: { createMany: jest.fn() },
};

jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    // create/update read the chosen category to enforce that products are filed on
    // a leaf. These tests are about options, so the default below is a leaf and the
    // check passes through.
    categories: { findFirst: jest.fn() },
  },
}));

const mockedPrisma = prisma as unknown as {
  $transaction: jest.Mock;
  categories: { findFirst: jest.Mock };
};

/** A leaf: no live sub-categories, so it's a valid home for a product. */
const LEAF_CATEGORY = {
  id: 'cat-1',
  name: 'Tropical Fruits',
  _count: { subCategories: 0 },
};
const mockedRepo = ProductRepository as jest.Mocked<typeof ProductRepository>;

const SELLER = { id: 'seller-1', applicationStatus: 'APPROVED' };
const STORE = { id: 'store-1', sellerId: 'seller-1', approvalStatus: 'ACTIVE' };
const PRODUCT = { id: 'prod-1', storeId: 'store-1' };

const BASE_CREATE = {
  name: 'Tee',
  price: 499,
  categoryId: 'cat-1',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedPrisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(txMock));
  mockedPrisma.categories.findFirst.mockResolvedValue(LEAF_CATEGORY);
  (mockedRepo.getSellerByUserId as jest.Mock).mockResolvedValue(SELLER);
  (mockedRepo.getStoreById as jest.Mock).mockResolvedValue(STORE);
  (mockedRepo.getProductById as jest.Mock).mockResolvedValue(PRODUCT);
  (mockedRepo.createProduct as jest.Mock).mockResolvedValue({ id: 'prod-1' });
  (mockedRepo.updateProduct as jest.Mock).mockResolvedValue({ id: 'prod-1' });
  (InventoryRepository.adjustWithin as jest.Mock) = jest.fn();
});

const createArg = () => (mockedRepo.createProduct as jest.Mock).mock.calls[0][0];
const updateArg = () => (mockedRepo.updateProduct as jest.Mock).mock.calls[0][1];

describe('category must be a leaf', () => {
  it('rejects a category that still has sub-categories', async () => {
    mockedPrisma.categories.findFirst.mockResolvedValue({
      id: 'cat-branch',
      name: 'Clothing',
      _count: { subCategories: 4 },
    });

    await expect(
      ProductService.createProduct('user-1', 'store-1', {
        ...BASE_CREATE,
        categoryId: 'cat-branch',
      }),
    ).rejects.toMatchObject({ status: 400 });

    // Rejected before any write — a branch category must not reach the transaction.
    expect(mockedRepo.createProduct).not.toHaveBeenCalled();
  });

  it('rejects a category that does not exist, rather than leaving it to Prisma', async () => {
    // Without this check a bad id surfaces as a P2025 that the error middleware
    // flattens to a bare 404 "Resource not found", indistinguishable from a missing
    // store or an expired session.
    mockedPrisma.categories.findFirst.mockResolvedValue(null);

    await expect(
      ProductService.createProduct('user-1', 'store-1', BASE_CREATE),
    ).rejects.toMatchObject({ status: 404, message: 'Category not found.' });
  });

  it('accepts a leaf', async () => {
    await expect(
      ProductService.createProduct('user-1', 'store-1', BASE_CREATE),
    ).resolves.toBeDefined();
  });

  it('skips the check on update when the caller is not changing the category', async () => {
    // A product filed before this rule existed must stay editable.
    await ProductService.updateProduct('user-1', 'prod-1', { name: 'Renamed' });
    expect(mockedPrisma.categories.findFirst).not.toHaveBeenCalled();
  });

  it('enforces the check on update when the category IS changing', async () => {
    mockedPrisma.categories.findFirst.mockResolvedValue({
      id: 'cat-branch',
      name: 'Clothing',
      _count: { subCategories: 4 },
    });

    await expect(
      ProductService.updateProduct('user-1', 'prod-1', { categoryId: 'cat-branch' }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('createProduct — option tier', () => {
  it('builds the nested option/value write tree', async () => {
    await ProductService.createProduct('user-1', 'store-1', {
      ...BASE_CREATE,
      options: [
        { name: 'Size', values: ['S', 'M'] },
        { name: 'Color', values: ['Red'] },
      ],
    });

    expect(createArg().options).toEqual({
      create: [
        { name: 'Size', position: 0, values: { create: [{ value: 'S' }, { value: 'M' }] } },
        { name: 'Color', position: 1, values: { create: [{ value: 'Red' }] } },
      ],
    });
  });

  it('omits `options` entirely when none are supplied — the strictly-optional case', async () => {
    await ProductService.createProduct('user-1', 'store-1', BASE_CREATE);
    expect(createArg().options).toBeUndefined();
  });

  it('omits `options` when every supplied option normalises away', async () => {
    await ProductService.createProduct('user-1', 'store-1', {
      ...BASE_CREATE,
      options: [{ name: 'Color', values: ['   '] }],
    });
    expect(createArg().options).toBeUndefined();
  });

  it('still writes the category as a relation connect, not a raw scalar', async () => {
    await ProductService.createProduct('user-1', 'store-1', {
      ...BASE_CREATE,
      options: [{ name: 'Size', values: ['S'] }],
    });

    expect(createArg().category).toEqual({ connect: { id: 'cat-1' } });
    expect(createArg().categoryId).toBeUndefined();
  });
});

describe('createProduct — transaction', () => {
  it('runs inside a transaction', async () => {
    await ProductService.createProduct('user-1', 'store-1', BASE_CREATE);
    expect(mockedPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('hands the transaction client to the repository, not the global prisma', async () => {
    // Guards the silent regression: passing `prisma` here type-checks but takes
    // the create outside the transaction, so a failed inventory write would
    // leave a product with no inventory row.
    await ProductService.createProduct('user-1', 'store-1', BASE_CREATE);
    expect((mockedRepo.createProduct as jest.Mock).mock.calls[0][1]).toBe(txMock);
  });

  it('creates the inventory row on the transaction client', async () => {
    await ProductService.createProduct('user-1', 'store-1', {
      ...BASE_CREATE,
      initialStock: 12,
    });

    expect(txMock.inventory.create).toHaveBeenCalledWith({
      data: {
        productId: 'prod-1',
        storeId: 'store-1',
        quantityOnHand: 12,
        quantityReserved: 0,
      },
    });
  });
});

describe('updateProduct — option tier replace-all', () => {
  it('replaces the whole option set when an array is provided', async () => {
    await ProductService.updateProduct('user-1', 'prod-1', {
      options: [{ name: 'Size', values: ['S'] }],
    });

    expect(updateArg().options).toEqual({
      deleteMany: {},
      create: [{ name: 'Size', position: 0, values: { create: [{ value: 'S' }] } }],
    });
  });

  it('clears every option when given an empty array', async () => {
    await ProductService.updateProduct('user-1', 'prod-1', { options: [] });

    expect(updateArg().options).toEqual({ deleteMany: {}, create: [] });
  });

  it('leaves options untouched when the key is omitted', async () => {
    // The distinction that `[]` (clear) and `undefined` (leave alone) must not
    // collapse into each other — both normalise to an empty array.
    await ProductService.updateProduct('user-1', 'prod-1', { name: 'Renamed' });

    expect(updateArg()).not.toHaveProperty('options');
  });

  it('does not leak the raw array into the update payload', async () => {
    await ProductService.updateProduct('user-1', 'prod-1', {
      options: [{ name: 'Size', values: ['S'] }],
    });

    expect(Array.isArray(updateArg().options)).toBe(false);
  });

  it('normalises before writing — duplicates collapse rather than reaching the DB', async () => {
    await ProductService.updateProduct('user-1', 'prod-1', {
      options: [
        { name: 'Size', values: ['S', 's'] },
        { name: 'size', values: ['M'] },
      ],
    });

    expect(updateArg().options.create).toEqual([
      { name: 'Size', position: 0, values: { create: [{ value: 'S' }] } },
    ]);
  });

  it('keeps tags and options as independent replace-all writes', async () => {
    await ProductService.updateProduct('user-1', 'prod-1', {
      tags: ['POPULAR'],
      options: [{ name: 'Size', values: ['S'] }],
    });

    expect(updateArg().tags).toEqual({
      deleteMany: {},
      create: [{ tag: { connect: { name: 'POPULAR' } } }],
    });
    expect(updateArg().options.deleteMany).toEqual({});
  });
});
