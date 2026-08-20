import { prisma } from '../../utils/prisma';

/**
 * Product and store reviews.
 *
 * Both models existed with screens at either end and no endpoint between them.
 * See FLAGS.md CAT-6 (product) and STO-6 (store).
 *
 * The rule throughout: you may only review something you actually bought. An
 * open review box on a marketplace is a spam target, and a rating that anyone
 * can post is not a signal a buyer can trust.
 */
export default class ReviewService {
  private static async resolveBuyerId(userId: string) {
    const buyer = await prisma.buyers.findUnique({ where: { userId } });
    if (!buyer) throw { status: 403, message: 'Only registered buyers can leave reviews.' };
    return buyer.id;
  }

  private static assertRating(rating: number) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw { status: 400, message: 'Rating must be a whole number from 1 to 5.' };
    }
  }

  // ── Product reviews ──────────────────────────────────────────────────────

  /**
   * Reviews for a product, newest first, with the running average.
   *
   * The average is computed here rather than read off `Products.ratingAverage`
   * so the list and the summary can never disagree; the denormalised column is
   * refreshed on write for the catalogue's benefit.
   */
  static async getProductReviews(
    productId: string,
    options: { skip?: number; take?: number } = {},
  ) {
    const [items, total, aggregate] = await Promise.all([
      prisma.productReviews.findMany({
        where: { productId },
        orderBy: { createdAt: 'desc' },
        skip: options.skip ?? 0,
        take: options.take ?? 20,
        include: { buyer: { select: { id: true, displayName: true } } },
      }),
      prisma.productReviews.count({ where: { productId } }),
      prisma.productReviews.aggregate({
        where: { productId },
        _avg: { rating: true },
      }),
    ]);

    return {
      items,
      total,
      averageRating: Number((aggregate._avg.rating ?? 0).toFixed(2)),
    };
  }

  /**
   * Leave or update a review for a product the caller has bought.
   *
   * Keyed on `(productId, buyerId, orderId)`, so a buyer who ordered the same
   * product twice may review each purchase, and a second submission for the
   * same order edits the first rather than stacking duplicates.
   */
  static async upsertProductReview(payload: {
    userId: string;
    productId: string;
    rating: number;
    comment?: string;
  }) {
    this.assertRating(payload.rating);
    const buyerId = await this.resolveBuyerId(payload.userId);

    // The purchase is the right to review. Only a completed order counts —
    // a pending one has not been handed over yet.
    const purchase = await prisma.orderItems.findFirst({
      where: {
        productId: payload.productId,
        order: { buyerId, status: 'COMPLETED' },
      },
      orderBy: { order: { completedAt: 'desc' } },
      select: { orderId: true },
    });

    if (!purchase) {
      throw {
        status: 403,
        message: 'You can only review a product from an order you have completed.',
      };
    }

    const review = await prisma.productReviews.upsert({
      where: {
        productId_buyerId_orderId: {
          productId: payload.productId,
          buyerId,
          orderId: purchase.orderId,
        },
      },
      create: {
        productId: payload.productId,
        buyerId,
        orderId: purchase.orderId,
        rating: payload.rating,
        comment: payload.comment,
      },
      update: { rating: payload.rating, comment: payload.comment },
    });

    await this.refreshProductRating(payload.productId);
    return review;
  }

  static async deleteProductReview(userId: string, reviewId: string) {
    const buyerId = await this.resolveBuyerId(userId);

    const review = await prisma.productReviews.findUnique({ where: { id: reviewId } });
    if (!review) throw { status: 404, message: 'Review not found.' };
    if (review.buyerId !== buyerId) {
      throw { status: 403, message: 'You can only delete your own review.' };
    }

    await prisma.productReviews.delete({ where: { id: reviewId } });
    await this.refreshProductRating(review.productId);
    return { message: 'Review deleted.' };
  }

  /**
   * Keep `Products.ratingAverage` / `ratingCount` in step with the reviews.
   *
   * The catalogue sorts and filters on these columns, so they cannot be left to
   * drift — but they are a cache, not the source of truth.
   */
  private static async refreshProductRating(productId: string) {
    const aggregate = await prisma.productReviews.aggregate({
      where: { productId },
      _avg: { rating: true },
      _count: { rating: true },
    });

    await prisma.products.update({
      where: { id: productId },
      data: {
        ratingAverage: Number((aggregate._avg.rating ?? 0).toFixed(2)),
        ratingCount: aggregate._count.rating,
      },
    });
  }

  // ── Store reviews ────────────────────────────────────────────────────────

  static async getStoreReviews(storeId: string, options: { skip?: number; take?: number } = {}) {
    const [items, total, aggregate] = await Promise.all([
      prisma.storeReviews.findMany({
        where: { storeId },
        orderBy: { createdAt: 'desc' },
        skip: options.skip ?? 0,
        take: options.take ?? 20,
        include: { buyer: { select: { id: true, displayName: true } } },
      }),
      prisma.storeReviews.count({ where: { storeId } }),
      prisma.storeReviews.aggregate({ where: { storeId }, _avg: { rating: true } }),
    ]);

    return {
      items,
      total,
      averageRating: Number((aggregate._avg.rating ?? 0).toFixed(2)),
    };
  }

  /**
   * One review per buyer per store — `@@unique([storeId, buyerId])` — so this
   * edits in place rather than accumulating. Requires a completed order from
   * that store.
   */
  static async upsertStoreReview(payload: {
    userId: string;
    storeId: string;
    rating: number;
    comment?: string;
  }) {
    this.assertRating(payload.rating);
    const buyerId = await this.resolveBuyerId(payload.userId);

    const purchase = await prisma.orders.findFirst({
      where: { buyerId, storeId: payload.storeId, status: 'COMPLETED' },
      select: { id: true },
    });

    if (!purchase) {
      throw {
        status: 403,
        message: 'You can only review a store you have completed an order with.',
      };
    }

    return prisma.storeReviews.upsert({
      where: { storeId_buyerId: { storeId: payload.storeId, buyerId } },
      create: {
        storeId: payload.storeId,
        buyerId,
        rating: payload.rating,
        comment: payload.comment,
      },
      update: { rating: payload.rating, comment: payload.comment },
    });
  }

  static async deleteStoreReview(userId: string, reviewId: string) {
    const buyerId = await this.resolveBuyerId(userId);

    const review = await prisma.storeReviews.findUnique({ where: { id: reviewId } });
    if (!review) throw { status: 404, message: 'Review not found.' };
    if (review.buyerId !== buyerId) {
      throw { status: 403, message: 'You can only delete your own review.' };
    }

    await prisma.storeReviews.delete({ where: { id: reviewId } });
    return { message: 'Review deleted.' };
  }

  /** Every review the caller has written, for a "my reviews" screen. */
  static async getMyReviews(userId: string) {
    const buyerId = await this.resolveBuyerId(userId);

    const [products, stores] = await Promise.all([
      prisma.productReviews.findMany({
        where: { buyerId },
        orderBy: { createdAt: 'desc' },
        include: { product: { select: { id: true, name: true } } },
      }),
      prisma.storeReviews.findMany({
        where: { buyerId },
        orderBy: { createdAt: 'desc' },
        include: { store: { select: { id: true, storeName: true } } },
      }),
    ]);

    return { productReviews: products, storeReviews: stores };
  }
}
