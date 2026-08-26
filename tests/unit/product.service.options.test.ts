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
  },
}));

const mockedPrisma = prisma as unknown as { $transaction: jest.Mock };
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
  (mockedRepo.getSellerByUserId as jest.Mock).mockResolvedValue(SELLER);
  (mockedRepo.getStoreById as jest.Mock).mockResolvedValue(STORE);
  (mockedRepo.getProductById as jest.Mock).mockResolvedValue(PRODUCT);
  (mockedRepo.createProduct as jest.Mock).mockResolvedValue({ id: 'prod-1' });
  (mockedRepo.updateProduct as jest.Mock).mockResolvedValue({ id: 'prod-1' });
  (InventoryRepository.adjustWithin as jest.Mock) = jest.fn();
});

const createArg = () => (mockedRepo.createProduct as jest.Mock).mock.calls[0][0];
const updateArg = () => (mockedRepo.updateProduct as jest.Mock).mock.calls[0][1];

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
