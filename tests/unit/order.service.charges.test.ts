import OrderService from '../../src/modules/orders/order.service';
import OrderRepository from '../../src/modules/orders/order.repository';
import { prisma } from '../../src/utils/prisma';

jest.mock('../../src/modules/orders/order.repository');
jest.mock('../../src/infrastructure/socket', () => ({
  emitNotificationToUser: jest.fn(),
}));
jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    stores: { findUnique: jest.fn() },
    buyers: { findUnique: jest.fn() },
    pricingConfigurations: { findFirst: jest.fn().mockResolvedValue(null) },
    pricingComponents: { findMany: jest.fn().mockResolvedValue([]) },
  },
}));

/**
 * OrderCharges is the audit trail the money is reconciled from, so these assert
 * the rows themselves rather than the totals on Orders.
 */
describe('OrderService.createOrder — OrderCharges ledger', () => {
  const PRICE = 500;
  const QUANTITY = 2;
  const SUBTOTAL = PRICE * QUANTITY; // 1,000

  function buildTx() {
    return {
      // Stock is reserved with a conditional UPDATE and holds are ended with an
      // UPDATE ... RETURNING, so a transaction client has to carry both raw
      // escape hatches. 1 affected row = the reservation was taken.
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([]),
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
      merchantAdProducts: { findMany: jest.fn().mockResolvedValue([]) },
      inventory: { update: jest.fn().mockResolvedValue({}) },
      inventoryReservations: {
        create: jest.fn().mockResolvedValue({ id: 'res-1' }),
        updateMany: jest.fn().mockResolvedValue({}),
      },
      payments: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      paymentMethods: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue({
          id: 'meth-cod',
          code: 'COD',
          type: 'CASH',
          isActive: true,
          providerId: 'prov-cash',
          provider: { id: 'prov-cash', code: 'CASH', name: 'Cash', isActive: true },
        }),
      },
    };
  }

  async function createOrderAndReadCharges() {
    const tx = buildTx();
    (prisma.$transaction as jest.Mock).mockImplementation((cb) => cb(tx));

    await OrderService.createOrder({
      buyerId: 'buyer-1',
      storeId: 'store-1',
      type: 'PICKUP' as never,
      paymentMethod: 'CASH_ON_DELIVERY' as never,
      items: [{ productId: 'product-1', quantity: QUANTITY }],
    });

    const orderData = (OrderRepository.insertOrder as jest.Mock).mock.calls[0][0];
    return { orderData, charges: orderData.charges.create as Record<string, unknown>[] };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    (OrderRepository.insertOrder as jest.Mock).mockImplementation((data) =>
      Promise.resolve({ id: 'order-1', ...data }),
    );
    (prisma.stores.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.buyers.findUnique as jest.Mock).mockResolvedValue(null);
  });

  it('never persists a TAX charge — the platform collects no VAT', async () => {
    const { charges } = await createOrderAndReadCharges();

    expect(charges.find((c) => c.type === 'TAX')).toBeUndefined();
    expect(charges.find((c) => c.beneficiary === 'GOVERNMENT')).toBeUndefined();
  });

  it('records the commission against the subtotal', async () => {
    const { charges } = await createOrderAndReadCharges();

    const commission = charges.find((c) => c.type === 'SELLER_MARKETPLACE_FEE');
    expect(commission).toBeDefined();
    expect(commission!.amount).toBe(20); // 2% of 1,000
    expect(commission!.payer).toBe('SELLER');
    expect(commission!.beneficiary).toBe('PLATFORM');
  });

  it('writes the product subtotal as its own row', async () => {
    const { charges } = await createOrderAndReadCharges();

    const product = charges.find((c) => c.type === 'PRODUCT');
    expect(product).toBeDefined();
    expect(product!.amount).toBe(SUBTOTAL);
  });

  it('keeps the ledger reconcilable with the order totals', async () => {
    const { orderData, charges } = await createOrderAndReadCharges();

    const amountOf = (type: string) => Number(charges.find((c) => c.type === type)?.amount ?? 0);

    // Buyer total = product + shipping - discount + buyer fee
    const buyerSide =
      amountOf('PRODUCT') +
      amountOf('SHIPPING') -
      amountOf('DISCOUNT') +
      amountOf('BUYER_TRANSACTION_FEE');

    expect(Number(buyerSide.toFixed(2))).toBe(Number(orderData.totalAmount));
    expect(amountOf('SELLER_MARKETPLACE_FEE')).toBe(Number(orderData.sellerMarketplaceFeeAmount));
  });

  it('omits rows for components the order does not have', async () => {
    const { charges } = await createOrderAndReadCharges();

    // No discount and no delivery on this order.
    expect(charges.find((c) => c.type === 'DISCOUNT')).toBeUndefined();
    expect(charges.find((c) => c.type === 'SHIPPING')).toBeUndefined();
  });
});
