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
        findMany: jest.fn().mockResolvedValue(
          bogoAd
            ? [
                {
                  ad: {
                    id: 'ad-1',
                    buyQuantity: bogoAd.buyQuantity,
                    freeQuantity: bogoAd.freeQuantity,
                  },
                },
              ]
            : [],
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

describe('OrderService.createOrder — percentage / fixed-amount discount', () => {
  const PRICE = 100;

  function buildTxWithAd(ad: Record<string, unknown> | null) {
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
        findMany: jest.fn().mockResolvedValue(ad ? [{ ad }] : []),
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

  it('applies a 20% discount off the line total', async () => {
    const tx = buildTxWithAd({ id: 'ad-pct', discountType: 'PERCENTAGE', discountValue: 20 });
    (prisma.$transaction as jest.Mock).mockImplementation((cb) => cb(tx));

    await OrderService.createOrder({
      buyerId: 'buyer-1',
      storeId: 'store-1',
      type: 'PICKUP' as never,
      paymentMethod: 'CASH_ON_DELIVERY' as never,
      items: [{ productId: 'product-1', quantity: 3 }],
    });

    const orderData = (OrderRepository.insertOrder as jest.Mock).mock.calls[0][0];
    expect(orderData.orderitems.create[0].discountAmount).toBeCloseTo(0.2 * 3 * PRICE);
    expect(orderData.orderitems.create[0].appliedAdId).toBe('ad-pct');
  });

  it('applies a fixed-amount discount per unit, capped at the line total', async () => {
    const tx = buildTxWithAd({ id: 'ad-fixed', discountType: 'FIXED_AMOUNT', discountValue: 30 });
    (prisma.$transaction as jest.Mock).mockImplementation((cb) => cb(tx));

    await OrderService.createOrder({
      buyerId: 'buyer-1',
      storeId: 'store-1',
      type: 'PICKUP' as never,
      paymentMethod: 'CASH_ON_DELIVERY' as never,
      items: [{ productId: 'product-1', quantity: 2 }],
    });

    const orderData = (OrderRepository.insertOrder as jest.Mock).mock.calls[0][0];
    expect(orderData.orderitems.create[0].discountAmount).toBe(60);
    expect(orderData.orderitems.create[0].appliedAdId).toBe('ad-fixed');
  });

  it('caps a fixed-amount discount at the line total when it would exceed it', async () => {
    const tx = buildTxWithAd({ id: 'ad-fixed', discountType: 'FIXED_AMOUNT', discountValue: 1000 });
    (prisma.$transaction as jest.Mock).mockImplementation((cb) => cb(tx));

    await OrderService.createOrder({
      buyerId: 'buyer-1',
      storeId: 'store-1',
      type: 'PICKUP' as never,
      paymentMethod: 'CASH_ON_DELIVERY' as never,
      items: [{ productId: 'product-1', quantity: 1 }],
    });

    const orderData = (OrderRepository.insertOrder as jest.Mock).mock.calls[0][0];
    expect(orderData.orderitems.create[0].discountAmount).toBe(PRICE);
  });
});
