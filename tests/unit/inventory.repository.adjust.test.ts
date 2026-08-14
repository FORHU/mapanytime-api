import InventoryRepository from '../../src/modules/inventory/inventory.repository';
import { prisma } from '../../src/utils/prisma';

jest.mock('../../src/utils/prisma', () => ({
  prisma: { $transaction: jest.fn() },
}));

const mockedPrisma = prisma as unknown as {
  $transaction: jest.Mock;
};

interface MockTx {
  inventory: {
    findFirst: jest.Mock;
    update: jest.Mock;
  };
  inventoryMovements: {
    create: jest.Mock;
  };
}

function buildTx(
  inventory: { id: string; storeId: string; quantityOnHand: number } | null,
): MockTx {
  return {
    inventory: {
      findFirst: jest.fn().mockResolvedValue(inventory),
      update: jest.fn().mockResolvedValue({}),
    },
    inventoryMovements: {
      create: jest.fn().mockResolvedValue({}),
    },
  };
}

describe('InventoryRepository.adjust', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('increases stock and writes an ADJUSTMENT audit row', async () => {
    const tx = buildTx({ id: 'inv-1', storeId: 'store-1', quantityOnHand: 10 });
    mockedPrisma.$transaction.mockImplementation(async (fn: (tx: MockTx) => Promise<unknown>) =>
      fn(tx),
    );

    const result = await InventoryRepository.adjust('product-1', 25, 'user-1');

    expect(tx.inventory.update).toHaveBeenCalledWith({
      where: { id: 'inv-1' },
      data: { quantityOnHand: 25 },
    });
    expect(tx.inventoryMovements.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inventoryId: 'inv-1',
        productId: 'product-1',
        storeId: 'store-1',
        movementType: 'ADJUSTMENT',
        quantityDelta: 15,
        previousOnHand: 10,
        newOnHand: 25,
        referenceType: 'MANUAL_ADJUSTMENT',
        createdById: 'user-1',
      }),
    });
    expect(result).toEqual({ productId: 'product-1', quantityOnHand: 25, changed: true });
  });

  it('decreases stock (floored at zero) and records a negative delta', async () => {
    const tx = buildTx({ id: 'inv-1', storeId: 'store-1', quantityOnHand: 10 });
    mockedPrisma.$transaction.mockImplementation(async (fn: (tx: MockTx) => Promise<unknown>) =>
      fn(tx),
    );

    const result = await InventoryRepository.adjust('product-1', 3, 'user-1');

    expect(tx.inventory.update).toHaveBeenCalledWith({
      where: { id: 'inv-1' },
      data: { quantityOnHand: 3 },
    });
    expect(tx.inventoryMovements.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ quantityDelta: -7, previousOnHand: 10, newOnHand: 3 }),
    });
    expect(result).toEqual({ productId: 'product-1', quantityOnHand: 3, changed: true });
  });

  it('floors a negative target at zero', async () => {
    const tx = buildTx({ id: 'inv-1', storeId: 'store-1', quantityOnHand: 4 });
    mockedPrisma.$transaction.mockImplementation(async (fn: (tx: MockTx) => Promise<unknown>) =>
      fn(tx),
    );

    const result = await InventoryRepository.adjust('product-1', -5, 'user-1');

    expect(tx.inventory.update).toHaveBeenCalledWith({
      where: { id: 'inv-1' },
      data: { quantityOnHand: 0 },
    });
    expect(result).toEqual({ productId: 'product-1', quantityOnHand: 0, changed: true });
  });

  it('no-ops when the target equals the current stock (no movement row)', async () => {
    const tx = buildTx({ id: 'inv-1', storeId: 'store-1', quantityOnHand: 7 });
    mockedPrisma.$transaction.mockImplementation(async (fn: (tx: MockTx) => Promise<unknown>) =>
      fn(tx),
    );

    const result = await InventoryRepository.adjust('product-1', 7, 'user-1');

    expect(tx.inventory.update).not.toHaveBeenCalled();
    expect(tx.inventoryMovements.create).not.toHaveBeenCalled();
    expect(result).toEqual({ productId: 'product-1', quantityOnHand: 7, changed: false });
  });

  it('rejects with 404 when no inventory row exists for the product', async () => {
    const tx = buildTx(null);
    mockedPrisma.$transaction.mockImplementation(async (fn: (tx: MockTx) => Promise<unknown>) =>
      fn(tx),
    );

    await expect(InventoryRepository.adjust('product-1', 10, 'user-1')).rejects.toMatchObject({
      status: 404,
    });
    expect(tx.inventory.update).not.toHaveBeenCalled();
  });
});
