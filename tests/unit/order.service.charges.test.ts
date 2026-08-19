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
    pricingConfigurations: { findFirst: jest.fn().mockResolvedValue(null) },
    pricingComponents: { findFirst: jest.fn().mockResolvedValue(null) },
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
        create: jest.fn().mockResolvedValue({}),
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
    (TaxationRepository.getCommissionRuleForCategory as jest.Mock).mockResolvedValue(null);
    (OrderRepository.insertOrder as jest.Mock).mockImplementation((data) =>
      Promise.resolve({ id: 'order-1', ...data }),
    );
    (prisma.stores.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.buyers.findUnique as jest.Mock).mockResolvedValue(null);
  });

  it('persists an explicit TAX charge', async () => {
    const { charges } = await createOrderAndReadCharges();

    const tax = charges.find((c) => c.type === 'TAX');
    expect(tax).toBeDefined();
    expect(tax!.amount).toBe(120); // 12% of 1,000
    expect(tax!.payer).toBe('BUYER');
    expect(tax!.beneficiary).toBe('GOVERNMENT');
  });

  it('records the commission against the subtotal, not the taxed order amount', async () => {
    const { charges } = await createOrderAndReadCharges();

    const commission = charges.find((c) => c.type === 'SELLER_MARKETPLACE_FEE');
    expect(commission).toBeDefined();
    expect(commission!.amount).toBe(20); // 2% of 1,000, not of 1,120
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

    // Buyer total = product + tax + shipping - discount + buyer fee
    const buyerSide =
      amountOf('PRODUCT') +
      amountOf('TAX') +
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
