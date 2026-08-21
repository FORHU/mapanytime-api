import CartService from '../../src/modules/cart/cart.service';
import ProductRepository from '../../src/modules/products/product.repository';
import RedisUtil from '../../src/utils/redis.util';
import { prisma } from '../../src/utils/prisma';

jest.mock('../../src/utils/redis.util', () => ({
  __esModule: true,
  default: { client: { get: jest.fn(), setEx: jest.fn(), del: jest.fn() } },
}));

jest.mock('../../src/modules/products/product.repository', () => ({
  __esModule: true,
  default: { getProductById: jest.fn() },
}));

jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    stores: { findUnique: jest.fn() },
    inventory: { findFirst: jest.fn() },
    merchantAdProducts: { findMany: jest.fn() },
  },
}));

const redis = RedisUtil.client as unknown as {
  get: jest.Mock;
  setEx: jest.Mock;
  del: jest.Mock;
};
const mockGetProduct = ProductRepository.getProductById as jest.Mock;
const mockStore = prisma.stores.findUnique as unknown as jest.Mock;
const mockInventory = prisma.inventory.findFirst as unknown as jest.Mock;
const mockMerchantAdProducts = prisma.merchantAdProducts.findMany as unknown as jest.Mock;

const USER = 'user-1';
const STORE = 'store-1';
const PRODUCT = 'prod-1';
const CART_KEY = `cart:${USER}`;
/** Seven days, matching the service. */
const CART_TTL = 604800;

/** Whatever the service last wrote to Redis, parsed back. */
const lastWrittenCart = () => JSON.parse(redis.setEx.mock.calls.at(-1)![2] as string);

const givenCart = (cart: unknown) => redis.get.mockResolvedValue(JSON.stringify(cart));

beforeEach(() => {
  jest.clearAllMocks();
  redis.get.mockResolvedValue(null);
  redis.setEx.mockResolvedValue('OK');
  redis.del.mockResolvedValue(1);
  mockStore.mockResolvedValue({ isActive: true });
  mockGetProduct.mockResolvedValue({
    id: PRODUCT,
    storeId: STORE,
    isActive: true,
    name: 'Running Shoes',
    price: '49.99',
  });
  mockInventory.mockResolvedValue({ quantityOnHand: 10, quantityReserved: 2 });
  mockMerchantAdProducts.mockResolvedValue([]);
});

describe('CartService.getCart', () => {
  it('returns an empty cart when nothing is stored', async () => {
    await expect(CartService.getCart(USER)).resolves.toEqual({ items: [] });
  });

  it('returns the stored cart', async () => {
    const stored = {
      items: [{ productId: PRODUCT, storeId: STORE, quantity: 2, unitPrice: 10 }],
    };
    givenCart(stored);

    await expect(CartService.getCart(USER)).resolves.toEqual(stored);
  });

  it('backfills the store onto items from a cart written before the split', async () => {
    // Redis holds carts for 7 days, so pre-deploy carts are still in flight and
    // carry storeId at the root with items that have none.
    givenCart({ storeId: STORE, items: [{ productId: PRODUCT, quantity: 2, unitPrice: 10 }] });

    await expect(CartService.getCart(USER)).resolves.toEqual({
      items: [{ productId: PRODUCT, storeId: STORE, quantity: 2, unitPrice: 10 }],
    });
  });
});

describe('CartService.addToCart', () => {
  it('adds a new item at the product price, tagged with its store', async () => {
    const cart = await CartService.addToCart(USER, STORE, PRODUCT, 3);

    expect(cart.items).toEqual([
      { productId: PRODUCT, storeId: STORE, quantity: 3, unitPrice: 49.99 },
    ]);
    // Price comes from the product record, never from the caller.
    expect(redis.setEx).toHaveBeenCalledWith(CART_KEY, CART_TTL, expect.any(String));
  });

  it('replaces the quantity of an existing item rather than adding to it', async () => {
    givenCart({
      items: [{ productId: PRODUCT, storeId: STORE, quantity: 2, unitPrice: 49.99 }],
    });

    const cart = await CartService.addToCart(USER, STORE, PRODUCT, 5);

    // Set-not-increment: the endpoint is idempotent for a given quantity, and a
    // retried request must not silently double what the buyer asked for.
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].quantity).toBe(5);
  });

  describe('quantity 0', () => {
    it('removes the item', async () => {
      givenCart({
        items: [
          { productId: PRODUCT, storeId: STORE, quantity: 2, unitPrice: 49.99 },
          { productId: 'prod-2', storeId: STORE, quantity: 1, unitPrice: 5 },
        ],
      });

      const cart = await CartService.addToCart(USER, STORE, PRODUCT, 0);

      expect(cart.items.map((i) => i.productId)).toEqual(['prod-2']);
    });

    it('empties the cart once the last item goes', async () => {
      givenCart({
        items: [{ productId: PRODUCT, storeId: STORE, quantity: 2, unitPrice: 49.99 }],
      });

      const cart = await CartService.addToCart(USER, STORE, PRODUCT, 0);

      expect(cart.items).toEqual([]);
    });

    it('skips the store, product and stock lookups entirely', async () => {
      givenCart({
        items: [{ productId: PRODUCT, storeId: STORE, quantity: 1, unitPrice: 1 }],
      });

      await CartService.addToCart(USER, STORE, PRODUCT, 0);

      // A removal must still work when the product has since been deactivated
      // or sold out — otherwise the buyer cannot empty their own cart.
      expect(mockStore).not.toHaveBeenCalled();
      expect(mockGetProduct).not.toHaveBeenCalled();
      expect(mockInventory).not.toHaveBeenCalled();
    });
  });

  describe('rejects', () => {
    it('an unknown store', async () => {
      mockStore.mockResolvedValue(null);
      await expect(CartService.addToCart(USER, STORE, PRODUCT, 1)).rejects.toMatchObject({
        status: 404,
      });
    });

    it('an inactive store', async () => {
      mockStore.mockResolvedValue({ isActive: false });
      await expect(CartService.addToCart(USER, STORE, PRODUCT, 1)).rejects.toMatchObject({
        status: 400,
      });
    });

    it('an unknown product', async () => {
      mockGetProduct.mockResolvedValue(null);
      await expect(CartService.addToCart(USER, STORE, PRODUCT, 1)).rejects.toMatchObject({
        status: 404,
      });
    });

    it('a product belonging to a different store', async () => {
      mockGetProduct.mockResolvedValue({
        id: PRODUCT,
        storeId: 'other-store',
        isActive: true,
        name: 'X',
        price: '1',
      });
      await expect(CartService.addToCart(USER, STORE, PRODUCT, 1)).rejects.toMatchObject({
        status: 400,
      });
    });

    it('an inactive product', async () => {
      mockGetProduct.mockResolvedValue({
        id: PRODUCT,
        storeId: STORE,
        isActive: false,
        name: 'X',
        price: '1',
      });
      await expect(CartService.addToCart(USER, STORE, PRODUCT, 1)).rejects.toMatchObject({
        status: 400,
      });
    });

    it('a missing inventory record', async () => {
      mockInventory.mockResolvedValue(null);
      await expect(CartService.addToCart(USER, STORE, PRODUCT, 1)).rejects.toMatchObject({
        status: 404,
      });
    });
  });

  describe('stock', () => {
    it('counts reserved units as unavailable', async () => {
      mockInventory.mockResolvedValue({ quantityOnHand: 10, quantityReserved: 2 });

      // 8 available. Ignoring quantityReserved here would oversell stock that
      // another buyer already holds in an open reservation.
      await expect(CartService.addToCart(USER, STORE, PRODUCT, 9)).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining('Only 8 left'),
      });
    });

    it('allows exactly the available quantity', async () => {
      mockInventory.mockResolvedValue({ quantityOnHand: 10, quantityReserved: 2 });

      const cart = await CartService.addToCart(USER, STORE, PRODUCT, 8);
      expect(cart.items[0].quantity).toBe(8);
    });
  });

  describe('BOGO bonus', () => {
    it('bumps the stored quantity with free units when a matching BOGO ad applies', async () => {
      mockMerchantAdProducts.mockResolvedValue([{ ad: { buyQuantity: 2, freeQuantity: 1 } }]);

      // Buyer asks to pay for 2; storing 2 alone would silently drop the
      // free unit they earned — the whole point of this feature.
      const cart = await CartService.addToCart(USER, STORE, PRODUCT, 2);

      expect(cart.items[0].quantity).toBe(3);
    });

    it('leaves quantity unchanged when no BOGO ad is linked', async () => {
      mockMerchantAdProducts.mockResolvedValue([]);

      const cart = await CartService.addToCart(USER, STORE, PRODUCT, 2);

      expect(cart.items[0].quantity).toBe(2);
    });

    it('caps the bump at available stock instead of rejecting the add', async () => {
      // Buyer's paid quantity (2) fits in stock (2), but the full bonus
      // bundle (2 paid + 1 free = 3) doesn't — the add must still succeed
      // for the 2 they asked to pay for, just without the extra free unit.
      mockInventory.mockResolvedValue({ quantityOnHand: 2, quantityReserved: 0 });
      mockMerchantAdProducts.mockResolvedValue([{ ad: { buyQuantity: 2, freeQuantity: 1 } }]);

      const cart = await CartService.addToCart(USER, STORE, PRODUCT, 2);

      expect(cart.items[0].quantity).toBe(2);
    });
  });
});

describe('CartService.addToCart across stores', () => {
  it('keeps lines from a second store alongside the first', async () => {
    // The single-store rule moved to checkout: a cart may hold several stores,
    // an order may not. See FIX-PLAN item 17.
    givenCart({
      items: [{ productId: 'prod-9', storeId: 'other-store', quantity: 1, unitPrice: 1 }],
    });

    const cart = await CartService.addToCart(USER, STORE, PRODUCT, 1);

    expect(cart.items).toEqual([
      { productId: 'prod-9', storeId: 'other-store', quantity: 1, unitPrice: 1 },
      { productId: PRODUCT, storeId: STORE, quantity: 1, unitPrice: 49.99 },
    ]);
  });
});

describe('CartService.removeItems', () => {
  it('removes only the named products', async () => {
    givenCart({
      items: [
        { productId: 'a', storeId: STORE, quantity: 1, unitPrice: 1 },
        { productId: 'b', storeId: STORE, quantity: 1, unitPrice: 1 },
        { productId: 'c', storeId: STORE, quantity: 1, unitPrice: 1 },
      ],
    });

    const cart = await CartService.removeItems(USER, ['a', 'c']);

    expect(cart.items.map((i) => i.productId)).toEqual(['b']);
    expect(lastWrittenCart().items).toHaveLength(1);
  });

  it('deletes the key when the cart empties', async () => {
    givenCart({ items: [{ productId: 'a', storeId: STORE, quantity: 1, unitPrice: 1 }] });

    const cart = await CartService.removeItems(USER, ['a']);

    expect(cart.items).toEqual([]);
    expect(redis.del).toHaveBeenCalledWith(CART_KEY);
    expect(redis.setEx).not.toHaveBeenCalled();
  });

  it('is a no-op on an already empty cart', async () => {
    const cart = await CartService.removeItems(USER, ['a']);

    expect(cart.items).toEqual([]);
    expect(redis.del).not.toHaveBeenCalled();
    expect(redis.setEx).not.toHaveBeenCalled();
  });
});

describe('CartService.clearCart', () => {
  it('deletes the stored cart', async () => {
    await CartService.clearCart(USER);
    expect(redis.del).toHaveBeenCalledWith(CART_KEY);
  });
});
