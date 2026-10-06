import OrderService from '../../src/modules/orders/order.service';
import InventoryStockRepository from '../../src/modules/inventory/inventoryStock.repository';
import { prisma } from '../../src/utils/prisma';

jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    orders: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    payments: {
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('../../src/modules/inventory/inventoryStock.repository', () => ({
  releaseOrderReservations: jest.fn(),
}));

describe('OrderService.expireStalePendingOrders (F44)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('expires stale orders and releases inventory holds', async () => {
    const staleOrders = [
      { id: 'order-1', buyerId: 'buyer-1' },
      { id: 'order-2', buyerId: 'buyer-2' },
    ];

    (prisma.orders.findMany as jest.Mock).mockResolvedValue(staleOrders);
    (prisma.$transaction as jest.Mock).mockImplementation(async (callback) => {
      const tx = {
        orders: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        payments: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      };
      return callback(tx);
    });

    const count = await OrderService.expireStalePendingOrders(15);

    expect(count).toBe(2);
    expect(InventoryStockRepository.releaseOrderReservations).toHaveBeenCalledWith(
      expect.anything(),
      'order-1',
      'EXPIRED',
    );
    expect(InventoryStockRepository.releaseOrderReservations).toHaveBeenCalledWith(
      expect.anything(),
      'order-2',
      'EXPIRED',
    );
  });

  it('returns 0 when no stale orders exist', async () => {
    (prisma.orders.findMany as jest.Mock).mockResolvedValue([]);

    const count = await OrderService.expireStalePendingOrders(15);

    expect(count).toBe(0);
    expect(InventoryStockRepository.releaseOrderReservations).not.toHaveBeenCalled();
  });
});
