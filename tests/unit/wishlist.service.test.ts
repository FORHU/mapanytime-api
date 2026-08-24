import WishlistService from '../../src/modules/wishlists/wishlist.service';
import { prisma } from '../../src/utils/prisma';

jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    buyers: { findUnique: jest.fn() },
    products: { findUnique: jest.fn() },
    wishlists: { findUnique: jest.fn(), upsert: jest.fn() },
    wishlistItems: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

const mockPrisma = prisma as unknown as Record<string, Record<string, jest.Mock>>;

const USER_ID = 'user-1';
const BUYER_ID = 'buyer-1';

/**
 * `Wishlists` / `WishlistItems` existed with no endpoint between them.
 * See FLAGS.md CAT-7.
 */
describe('WishlistService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.buyers.findUnique.mockResolvedValue({ id: BUYER_ID });
    mockPrisma.products.findUnique.mockResolvedValue({ id: 'prod-1' });
    mockPrisma.wishlists.upsert.mockResolvedValue({ id: 'wl-1' });
    mockPrisma.wishlistItems.findFirst.mockResolvedValue(null);
    mockPrisma.wishlistItems.create.mockResolvedValue({ id: 'item-1' });
  });

  // An empty row for every buyer who never used the feature buys nothing.
  it('creates the wishlist lazily on the first save', async () => {
    await WishlistService.addItem(USER_ID, 'prod-1');

    expect(mockPrisma.wishlists.upsert).toHaveBeenCalledWith({
      where: { buyerId: BUYER_ID },
      create: { buyerId: BUYER_ID },
      update: {},
    });
    expect(mockPrisma.wishlistItems.create).toHaveBeenCalledTimes(1);
  });

  // From the buyer's side it is already saved, so this is not an error.
  it('is a no-op when the product is already saved', async () => {
    mockPrisma.wishlistItems.findFirst.mockResolvedValue({ id: 'existing' });

    const result = await WishlistService.addItem(USER_ID, 'prod-1');

    expect(mockPrisma.wishlistItems.create).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 'existing' });
  });

  it('refuses to save a product that does not exist', async () => {
    mockPrisma.products.findUnique.mockResolvedValue(null);

    await expect(WishlistService.addItem(USER_ID, 'nope')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('refuses a user with no buyer profile', async () => {
    mockPrisma.buyers.findUnique.mockResolvedValue(null);

    await expect(WishlistService.addItem(USER_ID, 'prod-1')).rejects.toMatchObject({
      status: 403,
    });
  });

  // Returning an empty list rather than 404 keeps the "nothing saved yet"
  // state out of the client's error path.
  it('returns an empty wishlist rather than failing when none exists', async () => {
    mockPrisma.wishlists.findUnique.mockResolvedValue(null);

    const result = await WishlistService.getWishlist(USER_ID);

    expect(result).toEqual({ id: null, items: [], count: 0 });
  });

  it('counts the saved items', async () => {
    mockPrisma.wishlists.findUnique.mockResolvedValue({
      id: 'wl-1',
      items: [{ id: 'a' }, { id: 'b' }],
    });

    const result = await WishlistService.getWishlist(USER_ID);

    expect(result.count).toBe(2);
  });

  it('removes by product id, not item id', async () => {
    mockPrisma.wishlists.findUnique.mockResolvedValue({ id: 'wl-1' });
    mockPrisma.wishlistItems.deleteMany.mockResolvedValue({ count: 1 });

    const result = await WishlistService.removeItem(USER_ID, 'prod-1');

    expect(mockPrisma.wishlistItems.deleteMany).toHaveBeenCalledWith({
      where: { wishlistId: 'wl-1', productId: 'prod-1' },
    });
    expect(result).toEqual({ removed: 1 });
  });

  it('removing from a wishlist that never existed does nothing', async () => {
    mockPrisma.wishlists.findUnique.mockResolvedValue(null);

    expect(await WishlistService.removeItem(USER_ID, 'prod-1')).toEqual({ removed: 0 });
    expect(mockPrisma.wishlistItems.deleteMany).not.toHaveBeenCalled();
  });

  // One call for a whole product grid, rather than one per card.
  it('reports which of a set of products are saved, without duplicates', async () => {
    mockPrisma.wishlists.findUnique.mockResolvedValue({ id: 'wl-1' });
    mockPrisma.wishlistItems.findMany.mockResolvedValue([
      { productId: 'prod-1' },
      { productId: 'prod-2' },
      // Same product saved under two variants.
      { productId: 'prod-1' },
    ]);

    const result = await WishlistService.getSavedProductIds(USER_ID, ['prod-1', 'prod-2']);

    expect(result).toEqual(['prod-1', 'prod-2']);
  });
});
