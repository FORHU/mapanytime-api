import OrderService from '../../src/modules/orders/order.service';
import InventoryStockRepository from '../../src/modules/inventory/inventoryStock.repository';
import AuditService from '../../src/modules/audit/audit.service';
import { emitNotificationToUser } from '../../src/infrastructure/socket';
import { prisma } from '../../src/utils/prisma';
import { PAYMENTMETHODTYPE, PAYMENTSTATUS, USERVOUCHERSTATUS } from '@prisma/client';

jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    orders: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    payments: {
      updateMany: jest.fn(),
    },
    userVouchers: {
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('../../src/modules/inventory/inventoryStock.repository', () => ({
  releaseOrderReservations: jest.fn(),
}));

jest.mock('../../src/modules/audit/audit.service', () => ({
  record: jest.fn(),
}));

jest.mock('../../src/infrastructure/socket', () => ({
  emitNotificationToUser: jest.fn(),
}));

describe('OrderService.expireUnacceptedCashOrders (F108)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('expires unaccepted cash orders past pickupAt + 2h grace period', async () => {
    const now = new Date('2026-11-26T12:00:00.000Z');
    const pastPickup = new Date('2026-11-26T09:00:00.000Z'); // 3 hours ago (> 2h grace)

    const staleCashOrders = [
      {
        id: 'order-cash-1',
        buyerId: 'buyer-1',
        storeId: 'store-1',
        pickupAt: pastPickup,
        buyer: { userId: 'user-buyer-1' },
        storeName: 'Aling Nena Grocery',
      },
    ];

    (prisma.orders.findMany as jest.Mock).mockResolvedValue(staleCashOrders);
    let capturedTx: any;
    (prisma.$transaction as jest.Mock).mockImplementation(async (callback) => {
      const tx = {
        orders: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        payments: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        userVouchers: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      };
      capturedTx = tx;
      return callback(tx);
    });

    const expiredCount = await OrderService.expireUnacceptedCashOrders(now);

    expect(expiredCount).toBe(1);

    // Verifies Prisma query criteria
    const findArgs = (prisma.orders.findMany as jest.Mock).mock.calls[0][0];
    expect(findArgs.where.status).toBe('PENDING');
    expect(findArgs.where.payment.some.paymentMethod.type).toBe(PAYMENTMETHODTYPE.CASH);
    expect(findArgs.where.payment.some.status).toBe(PAYMENTSTATUS.PENDING);

    // Verifies Inventory reservation release
    expect(InventoryStockRepository.releaseOrderReservations).toHaveBeenCalledWith(
      expect.anything(),
      'order-cash-1',
      'EXPIRED',
    );

    // Verifies Audit log recording
    expect(AuditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ORDER_EXPIRED_UNACCEPTED_CASH',
        entityType: 'ORDER',
        entityId: 'order-cash-1',
      }),
    );

    // Verifies UserVoucher restoral splits between ACTIVE and EXPIRED based on expiresAt vs now
    expect(capturedTx.userVouchers.updateMany).toHaveBeenCalledWith({
      where: {
        orderId: 'order-cash-1',
        status: USERVOUCHERSTATUS.USED,
        expiresAt: { gt: now },
      },
      data: { status: USERVOUCHERSTATUS.ACTIVE, orderId: null },
    });
    expect(capturedTx.userVouchers.updateMany).toHaveBeenCalledWith({
      where: {
        orderId: 'order-cash-1',
        status: USERVOUCHERSTATUS.USED,
        expiresAt: { lte: now },
      },
      data: { status: USERVOUCHERSTATUS.EXPIRED, orderId: null },
    });

    // Verifies notification emission to buyer
    expect(emitNotificationToUser).toHaveBeenCalledWith(
      'user-buyer-1',
      expect.objectContaining({
        title: 'Cash order cancelled',
        metadata: expect.objectContaining({
          orderId: 'order-cash-1',
          status: 'CANCELLED',
        }),
      }),
    );
  });

  it('correctly calculates 2-hour grace period cutoff in query', async () => {
    const fixedNow = new Date('2026-11-26T14:00:00.000Z');
    (prisma.orders.findMany as jest.Mock).mockResolvedValue([]);

    await OrderService.expireUnacceptedCashOrders(fixedNow);

    const { where } = (prisma.orders.findMany as jest.Mock).mock.calls[0][0];
    const expectedGraceCutoff = new Date(fixedNow.getTime() - 2 * 60 * 60 * 1000);

    expect(where.OR).toEqual([
      {
        pickupAt: { not: null, lte: expectedGraceCutoff },
      },
      {
        pickupAt: null,
        createdAt: { lte: expectedGraceCutoff },
      },
    ]);
  });

  it('skips side effects if order was concurrently updated', async () => {
    const staleCashOrders = [
      {
        id: 'order-concurrent',
        buyerId: 'buyer-2',
        storeId: 'store-2',
        pickupAt: new Date('2026-11-26T08:00:00.000Z'),
        buyer: { userId: 'user-buyer-2' },
        storeName: 'Bakery',
      },
    ];

    (prisma.orders.findMany as jest.Mock).mockResolvedValue(staleCashOrders);
    (prisma.$transaction as jest.Mock).mockImplementation(async (callback) => {
      const tx = {
        orders: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }), // Concurrently changed!
        },
        payments: {
          updateMany: jest.fn(),
        },
        userVouchers: {
          updateMany: jest.fn(),
        },
      };
      return callback(tx);
    });

    const expiredCount = await OrderService.expireUnacceptedCashOrders();

    expect(expiredCount).toBe(0);
    expect(InventoryStockRepository.releaseOrderReservations).not.toHaveBeenCalled();
    expect(AuditService.record).not.toHaveBeenCalled();
    expect(emitNotificationToUser).not.toHaveBeenCalled();
  });

  it('returns 0 when no unaccepted cash orders are expired', async () => {
    (prisma.orders.findMany as jest.Mock).mockResolvedValue([]);

    const count = await OrderService.expireUnacceptedCashOrders();

    expect(count).toBe(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
