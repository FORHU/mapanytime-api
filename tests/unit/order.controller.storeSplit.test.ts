import OrderController from '../../src/modules/orders/order.controller';
import OrderService from '../../src/modules/orders/order.service';
import CartService from '../../src/modules/cart/cart.service';
import { prisma } from '../../src/utils/prisma';
import RedisUtil from '../../src/utils/redis.util';
import type { Request, Response, NextFunction } from 'express';

/**
 * A cart may hold several stores; an order may not. `Orders.storeId` is
 * singular and each order settles to exactly one seller, so the store rule
 * that used to block add-to-cart now lives at checkout. See FIX-PLAN item 17.
 */
jest.mock('../../src/modules/orders/order.service');
jest.mock('../../src/modules/cart/cart.service');
jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    buyers: { findUnique: jest.fn(), create: jest.fn() },
    users: { findUnique: jest.fn() },
  },
}));

const BUYER = 'buyer-1';
const USER = 'user-1';

function mockRes() {
  const res = {} as Response & { statusCode?: number; body?: unknown };
  res.status = jest.fn().mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn().mockImplementation((body: unknown) => {
    res.body = body;
    return res;
  });
  return res;
}

const req = (body: Record<string, unknown>) =>
  ({ body, headers: {}, user: { id: USER } }) as unknown as Request;

const next = jest.fn() as unknown as NextFunction;

const cartOf = (items: { productId: string; storeId: string }[]) =>
  (CartService.getCart as jest.Mock).mockResolvedValue({
    items: items.map((item) => ({ ...item, quantity: 1, unitPrice: 10 })),
  });

beforeEach(() => {
  jest.clearAllMocks();
  (RedisUtil as unknown as { client: unknown }).client = { isOpen: false };
  (prisma.buyers.findUnique as jest.Mock).mockResolvedValue({ id: BUYER });
  (OrderService.createOrder as jest.Mock).mockResolvedValue({ id: 'order-1' });
});

describe('OrderController.create — one store per order', () => {
  it('rejects a checkout spanning two stores', async () => {
    cartOf([
      { productId: 'product-1', storeId: 'store-1' },
      { productId: 'product-2', storeId: 'store-2' },
    ]);
    const res = mockRes();

    await OrderController.create(req({ type: 'PICKUP', pickupAt: futureDate() }), res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ message: expect.stringContaining('one store at a time') });
    expect(OrderService.createOrder).not.toHaveBeenCalled();
  });

  it('accepts a selection that narrows a mixed cart to one store', async () => {
    cartOf([
      { productId: 'product-1', storeId: 'store-1' },
      { productId: 'product-2', storeId: 'store-2' },
    ]);
    const res = mockRes();

    await OrderController.create(
      req({ type: 'PICKUP', pickupAt: futureDate(), productIds: ['product-2'] }),
      res,
      next,
    );

    expect(OrderService.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ storeId: 'store-2', buyerId: BUYER }),
    );
  });

  it('takes the store from the cart lines rather than a cart-level field', async () => {
    cartOf([{ productId: 'product-1', storeId: 'store-9' }]);
    const res = mockRes();

    await OrderController.create(req({ type: 'PICKUP', pickupAt: futureDate() }), res, next);

    expect(OrderService.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ storeId: 'store-9' }),
    );
  });

  it('still rejects an empty cart', async () => {
    cartOf([]);
    const res = mockRes();

    await OrderController.create(req({ type: 'PICKUP', pickupAt: futureDate() }), res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ message: expect.stringContaining('cart is empty') });
    expect(OrderService.createOrder).not.toHaveBeenCalled();
  });
});

/** pickupAt must be in the future to clear validation. */
function futureDate() {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString();
}
