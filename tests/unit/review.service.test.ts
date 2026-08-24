import ReviewService from '../../src/modules/reviews/review.service';
import { prisma } from '../../src/utils/prisma';

jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    buyers: { findUnique: jest.fn() },
    orders: { findFirst: jest.fn() },
    orderItems: { findFirst: jest.fn() },
    products: { update: jest.fn() },
    productReviews: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
    storeReviews: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

const mockPrisma = prisma as unknown as Record<string, Record<string, jest.Mock>>;

const USER_ID = 'user-1';
const BUYER_ID = 'buyer-1';

/**
 * Both review models shipped with screens at either end and no endpoint
 * between them. See FLAGS.md CAT-6 / STO-6. The rule these pin: a review
 * requires a completed purchase of the thing being reviewed.
 */
describe('ReviewService — product reviews', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.buyers.findUnique.mockResolvedValue({ id: BUYER_ID });
    mockPrisma.orderItems.findFirst.mockResolvedValue({ orderId: 'order-1' });
    mockPrisma.productReviews.upsert.mockResolvedValue({ id: 'rev-1' });
    mockPrisma.productReviews.aggregate.mockResolvedValue({
      _avg: { rating: 4.5 },
      _count: { rating: 2 },
    });
  });

  it('accepts a review from a buyer who completed an order for the product', async () => {
    await ReviewService.upsertProductReview({
      userId: USER_ID,
      productId: 'prod-1',
      rating: 5,
      comment: 'Great beans',
    });

    expect(mockPrisma.productReviews.upsert).toHaveBeenCalledTimes(1);
  });

  // An open review box on a marketplace is a spam target, and a rating anyone
  // can post is not a signal a buyer can trust.
  it('refuses a review from someone who never bought the product', async () => {
    mockPrisma.orderItems.findFirst.mockResolvedValue(null);

    await expect(
      ReviewService.upsertProductReview({ userId: USER_ID, productId: 'prod-1', rating: 5 }),
    ).rejects.toMatchObject({ status: 403 });

    expect(mockPrisma.productReviews.upsert).not.toHaveBeenCalled();
  });

  it('only counts completed orders as a purchase', async () => {
    await ReviewService.upsertProductReview({ userId: USER_ID, productId: 'prod-1', rating: 4 });

    const where = mockPrisma.orderItems.findFirst.mock.calls[0][0].where;
    expect(where.order.status).toBe('COMPLETED');
    expect(where.order.buyerId).toBe(BUYER_ID);
  });

  it.each([0, 6, 2.5, -1])('rejects a rating of %s', async (rating) => {
    await expect(
      ReviewService.upsertProductReview({ userId: USER_ID, productId: 'prod-1', rating }),
    ).rejects.toMatchObject({ status: 400 });
  });

  // The catalogue sorts and filters on these columns, so they cannot drift.
  it('refreshes the product rating cache after a review', async () => {
    await ReviewService.upsertProductReview({ userId: USER_ID, productId: 'prod-1', rating: 5 });

    expect(mockPrisma.products.update).toHaveBeenCalledWith({
      where: { id: 'prod-1' },
      data: { ratingAverage: 4.5, ratingCount: 2 },
    });
  });

  // Keyed on (productId, buyerId, orderId), so a resubmission edits.
  it('edits in place rather than stacking duplicates', async () => {
    await ReviewService.upsertProductReview({ userId: USER_ID, productId: 'prod-1', rating: 3 });

    const call = mockPrisma.productReviews.upsert.mock.calls[0][0];
    expect(call.where.productId_buyerId_orderId).toEqual({
      productId: 'prod-1',
      buyerId: BUYER_ID,
      orderId: 'order-1',
    });
    expect(call.update).toEqual({ rating: 3, comment: undefined });
  });

  it('refuses to delete someone else', async () => {
    mockPrisma.productReviews.findUnique.mockResolvedValue({
      id: 'rev-1',
      buyerId: 'someone-else',
      productId: 'prod-1',
    });

    await expect(ReviewService.deleteProductReview(USER_ID, 'rev-1')).rejects.toMatchObject({
      status: 403,
    });
    expect(mockPrisma.productReviews.delete).not.toHaveBeenCalled();
  });

  it('reports the average alongside the list', async () => {
    mockPrisma.productReviews.findMany.mockResolvedValue([{ id: 'rev-1' }]);
    mockPrisma.productReviews.count.mockResolvedValue(1);
    mockPrisma.productReviews.aggregate.mockResolvedValue({ _avg: { rating: 4.333 } });

    const result = await ReviewService.getProductReviews('prod-1');

    expect(result.total).toBe(1);
    expect(result.averageRating).toBe(4.33);
  });

  it('reports a zero average when nothing has been reviewed', async () => {
    mockPrisma.productReviews.findMany.mockResolvedValue([]);
    mockPrisma.productReviews.count.mockResolvedValue(0);
    mockPrisma.productReviews.aggregate.mockResolvedValue({ _avg: { rating: null } });

    const result = await ReviewService.getProductReviews('prod-1');

    expect(result.averageRating).toBe(0);
  });
});

describe('ReviewService — store reviews', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.buyers.findUnique.mockResolvedValue({ id: BUYER_ID });
    mockPrisma.orders.findFirst.mockResolvedValue({ id: 'order-1' });
    mockPrisma.storeReviews.upsert.mockResolvedValue({ id: 'srev-1' });
  });

  it('accepts a review from a buyer who completed an order with the store', async () => {
    await ReviewService.upsertStoreReview({ userId: USER_ID, storeId: 'store-1', rating: 5 });

    expect(mockPrisma.storeReviews.upsert).toHaveBeenCalledTimes(1);
  });

  it('refuses a review from someone who never ordered from the store', async () => {
    mockPrisma.orders.findFirst.mockResolvedValue(null);

    await expect(
      ReviewService.upsertStoreReview({ userId: USER_ID, storeId: 'store-1', rating: 5 }),
    ).rejects.toMatchObject({ status: 403 });
  });

  // @@unique([storeId, buyerId]) — one per buyer per store.
  it('keeps one review per buyer per store', async () => {
    await ReviewService.upsertStoreReview({ userId: USER_ID, storeId: 'store-1', rating: 2 });

    const call = mockPrisma.storeReviews.upsert.mock.calls[0][0];
    expect(call.where.storeId_buyerId).toEqual({ storeId: 'store-1', buyerId: BUYER_ID });
  });

  it('refuses a review from a user with no buyer profile', async () => {
    mockPrisma.buyers.findUnique.mockResolvedValue(null);

    await expect(
      ReviewService.upsertStoreReview({ userId: USER_ID, storeId: 'store-1', rating: 5 }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
