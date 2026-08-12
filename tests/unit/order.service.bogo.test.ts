import OrderService from '../../src/modules/orders/order.service';
import OrderRepository from '../../src/modules/orders/order.repository';
import TaxationRepository from '../../src/modules/taxation/taxation.repository';
import { prisma } from '../../src/utils/prisma';

jest.mock('../../src/modules/orders/order.repository');
jest.mock('../../src/modules/taxation/taxation.repository');
jest.mock('../../src/infrastructure/socket', () => ({
  emitNotificationToUser: jest.fn(),
}));
jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    stores: { findUnique: jest.fn() },
    buyers: { findUnique: jest.fn() },
  },
}));

describe('OrderService.createOrder — BOGO discount', () => {
  const PRICE = 100;

  function buildTx(bogoAd: { buyQuantity: number; freeQuantity: number } | null) {
    return {
      stores: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'store-1',
          storeName: 'Test Store',
          isActive: true,
          phone: null,
          email: null,
          storeLocations: null,
          seller: { users: null },
        }),
      },
      products: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'product-1',
          name: 'Widget',
          storeId: 'store-1',
          isActive: true,
          categoryId: null,
          price: PRICE,
          inventory: [{ id: 'inv-1', quantityOnHand: 100, quantityReserved: 0 }],
        }),
      },
      merchantAdProducts: {
        findFirst: jest.fn().mockResolvedValue(
          bogoAd
            ? {
                ad: {
                  id: 'ad-1',
                  buyQuantity: bogoAd.buyQuantity,
                  freeQuantity: bogoAd.freeQuantity,
                },
              }
            : null,
        ),
      },
      inventory: { update: jest.fn().mockResolvedValue({}) },
      inventoryReservations: {
        create: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({}),
      },
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    (TaxationRepository.getCommissionRuleForCategory as jest.Mock).mockResolvedValue(null);
    (OrderRepository.insertOrder as jest.Mock).mockImplementation((data) =>
      Promise.resolve({ id: 'order-1', ...data }),
    );
    (prisma.stores.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.buyers.findUnique as jest.Mock).mockResolvedValue(null);
  });

  it('gives away 2 free units for buy-1-take-1 on a quantity of 4', async () => {
    const tx = buildTx({ buyQuantity: 1, freeQuantity: 1 });
    (prisma.$transaction as jest.Mock).mockImplementation((cb) => cb(tx));

    await OrderService.createOrder({
      buyerId: 'buyer-1',
      storeId: 'store-1',
      type: 'PICKUP' as never,
      paymentMethod: 'CASH_ON_DELIVERY' as never,
      items: [{ productId: 'product-1', quantity: 4 }],
    });

    const orderData = (OrderRepository.insertOrder as jest.Mock).mock.calls[0][0];
    // 4 units / (buy 1 + take 1 = bundle of 2) = 2 bundles -> 2 free units
    expect(orderData.orderitems.create[0].discountAmount).toBe(2 * PRICE);
    expect(orderData.orderitems.create[0].appliedAdId).toBe('ad-1');
    expect(orderData.discountAmount).toBe(2 * PRICE);
    expect(orderData.subtotalAmount).toBe(4 * PRICE);
  });

  it('gives away 0 free units when quantity is below one full bundle', async () => {
    const tx = buildTx({ buyQuantity: 1, freeQuantity: 1 });
    (prisma.$transaction as jest.Mock).mockImplementation((cb) => cb(tx));

    await OrderService.createOrder({
      buyerId: 'buyer-1',
      storeId: 'store-1',
      type: 'PICKUP' as never,
      paymentMethod: 'CASH_ON_DELIVERY' as never,
      items: [{ productId: 'product-1', quantity: 1 }],
    });

    const orderData = (OrderRepository.insertOrder as jest.Mock).mock.calls[0][0];
    expect(orderData.orderitems.create[0].discountAmount).toBe(0);
    expect(orderData.orderitems.create[0].appliedAdId).toBeNull();
  });

  it('applies no discount when no BOGO ad is linked to the product', async () => {
    const tx = buildTx(null);
    (prisma.$transaction as jest.Mock).mockImplementation((cb) => cb(tx));

    await OrderService.createOrder({
      buyerId: 'buyer-1',
      storeId: 'store-1',
      type: 'PICKUP' as never,
      paymentMethod: 'CASH_ON_DELIVERY' as never,
      items: [{ productId: 'product-1', quantity: 4 }],
    });

    const orderData = (OrderRepository.insertOrder as jest.Mock).mock.calls[0][0];
    expect(orderData.orderitems.create[0].discountAmount).toBe(0);
    expect(orderData.discountAmount).toBe(0);
  });
});
