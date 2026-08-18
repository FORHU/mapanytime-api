import CartService from '../../src/modules/cart/cart.service';
import ProductRepository from '../../src/modules/products/product.repository';
import TaxationRepository from '../../src/modules/taxation/taxation.repository';
import RedisUtil from '../../src/utils/redis.util';
import { prisma } from '../../src/utils/prisma';

jest.mock('../../src/modules/products/product.repository');
jest.mock('../../src/modules/taxation/taxation.repository');
jest.mock('../../src/utils/prisma', () => ({
  prisma: { merchantAdProducts: { findMany: jest.fn() } },
}));

const PRICE = 100;

function mockCart(items: { productId: string; quantity: number; unitPrice: number }[]) {
  (RedisUtil as unknown as { client: unknown }).client = {
    get: jest.fn().mockResolvedValue(JSON.stringify({ storeId: 'store-1', items })),
  };
}

function mockProduct(productId: string, overrides: Record<string, unknown> = {}) {
  (ProductRepository.getProductById as jest.Mock).mockImplementation((id: string) =>
    id === productId
      ? Promise.resolve({ id, price: PRICE, isActive: true, categoryId: null, ...overrides })
      : Promise.resolve(null),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  (TaxationRepository.getCommissionRuleForCategory as jest.Mock).mockResolvedValue(null);
  (prisma.merchantAdProducts.findMany as jest.Mock).mockResolvedValue([]);
});

describe('CartService.previewPricing', () => {
  it('rejects an empty cart', async () => {
    mockCart([]);
    await expect(CartService.previewPricing('user-1')).rejects.toMatchObject({ status: 400 });
  });

  it('previews the full cart with no discount', async () => {
    mockCart([{ productId: 'product-1', quantity: 2, unitPrice: PRICE }]);
    mockProduct('product-1');

    const pricing = await CartService.previewPricing('user-1');

    expect(pricing.items).toEqual([
      {
        productId: 'product-1',
        quantity: 2,
        unitPrice: PRICE,
        discountAmount: 0,
        appliedAdId: null,
        freeUnits: 0,
      },
    ]);
    expect(pricing.subtotalAmount).toBe(2 * PRICE);
    expect(pricing.discountAmount).toBe(0);
    expect(pricing.totalAmount).toBe(pricing.subtotalAmount + pricing.taxAmount);
  });

  it('applies an active percentage discount, matching order-creation math', async () => {
    mockCart([{ productId: 'product-1', quantity: 1, unitPrice: PRICE }]);
    mockProduct('product-1');
    (prisma.merchantAdProducts.findMany as jest.Mock).mockResolvedValue([
      { ad: { id: 'ad-1', discountType: 'PERCENTAGE', discountValue: 20 } },
    ]);

    const pricing = await CartService.previewPricing('user-1');

    expect(pricing.items[0].discountAmount).toBeCloseTo(20);
    expect(pricing.items[0].appliedAdId).toBe('ad-1');
    expect(pricing.items[0].freeUnits).toBe(0);
    expect(pricing.discountAmount).toBeCloseTo(20);
  });

  it('reports freeUnits for an active BOGO discount that reaches its bundle size', async () => {
    // Quantity 3 = a complete "buy 2 get 1 free" bundle (bundleSize = 3).
    mockCart([{ productId: 'product-1', quantity: 3, unitPrice: PRICE }]);
    mockProduct('product-1');
    (prisma.merchantAdProducts.findMany as jest.Mock).mockResolvedValue([
      { ad: { id: 'ad-bogo', discountType: 'BOGO', buyQuantity: 2, freeQuantity: 1 } },
    ]);

    const pricing = await CartService.previewPricing('user-1');

    expect(pricing.items[0].freeUnits).toBe(1);
    expect(pricing.items[0].discountAmount).toBeCloseTo(PRICE);
    expect(pricing.items[0].appliedAdId).toBe('ad-bogo');
  });

  it('picks the best discount when multiple ads are linked to the same product', async () => {
    // Regression: a BOGO ad that doesn't reach its bundle size at this
    // quantity used to shadow a % off ad on the same product, silently
    // showing $0 off. The buyer should get whichever discount is bigger.
    mockCart([{ productId: 'product-1', quantity: 2, unitPrice: PRICE }]);
    mockProduct('product-1');
    (prisma.merchantAdProducts.findMany as jest.Mock).mockResolvedValue([
      { ad: { id: 'ad-bogo', discountType: 'BOGO', buyQuantity: 2, freeQuantity: 1 } },
      { ad: { id: 'ad-pct', discountType: 'PERCENTAGE', discountValue: 20 } },
    ]);

    const pricing = await CartService.previewPricing('user-1');

    expect(pricing.items[0].appliedAdId).toBe('ad-pct');
    expect(pricing.items[0].discountAmount).toBeCloseTo(40);
  });

  it('filters to the selected productIds only', async () => {
    mockCart([
      { productId: 'product-1', quantity: 1, unitPrice: PRICE },
      { productId: 'product-2', quantity: 1, unitPrice: PRICE },
    ]);
    (ProductRepository.getProductById as jest.Mock).mockImplementation((id: string) =>
      Promise.resolve({ id, price: PRICE, isActive: true, categoryId: null }),
    );

    const pricing = await CartService.previewPricing('user-1', ['product-2']);

    expect(pricing.items).toHaveLength(1);
    expect(pricing.items[0].productId).toBe('product-2');
    expect(pricing.subtotalAmount).toBe(PRICE);
  });

  it('rejects when none of the requested productIds are in the cart', async () => {
    mockCart([{ productId: 'product-1', quantity: 1, unitPrice: PRICE }]);

    await expect(CartService.previewPricing('user-1', ['product-missing'])).rejects.toMatchObject({
      status: 400,
    });
  });
});
