import CartService from '../../src/modules/cart/cart.service';
import ProductRepository from '../../src/modules/products/product.repository';
import TaxationRepository from '../../src/modules/taxation/taxation.repository';
import RedisUtil from '../../src/utils/redis.util';
import { prisma } from '../../src/utils/prisma';

jest.mock('../../src/modules/products/product.repository');
jest.mock('../../src/modules/taxation/taxation.repository');
jest.mock('../../src/utils/prisma', () => ({
  prisma: { merchantAdProducts: { findFirst: jest.fn() } },
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
  (prisma.merchantAdProducts.findFirst as jest.Mock).mockResolvedValue(null);
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
      { productId: 'product-1', quantity: 2, unitPrice: PRICE, discountAmount: 0, appliedAdId: null },
    ]);
    expect(pricing.subtotalAmount).toBe(2 * PRICE);
    expect(pricing.discountAmount).toBe(0);
    expect(pricing.totalAmount).toBe(pricing.subtotalAmount + pricing.taxAmount);
  });

  it('applies an active percentage discount, matching order-creation math', async () => {
    mockCart([{ productId: 'product-1', quantity: 1, unitPrice: PRICE }]);
    mockProduct('product-1');
    (prisma.merchantAdProducts.findFirst as jest.Mock).mockResolvedValue({
      ad: { id: 'ad-1', discountType: 'PERCENTAGE', discountValue: 20 },
    });

    const pricing = await CartService.previewPricing('user-1');

    expect(pricing.items[0].discountAmount).toBeCloseTo(20);
    expect(pricing.items[0].appliedAdId).toBe('ad-1');
    expect(pricing.discountAmount).toBeCloseTo(20);
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

    await expect(
      CartService.previewPricing('user-1', ['product-missing']),
    ).rejects.toMatchObject({ status: 400 });
  });
});
