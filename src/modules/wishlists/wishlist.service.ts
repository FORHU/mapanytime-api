import { prisma } from '../../utils/prisma';
import S3Util from '../../utils/s3.util';
import { S3_CDN_URL } from '../../config';

/**
 * Same pattern as product.repository.ts / store.service.ts / merchantAds.service.ts.
 * TODO: extract to a shared util (4th copy now) — also unlike S3Util.getPublicUrl,
 * this doesn't strip a trailing slash from S3_CDN_URL, so a trailing-slash config
 * produces double-slash (404-prone) URLs.
 */
async function resolveImageUrl(file: { path: string; bucket?: string | null }): Promise<string> {
  if (S3_CDN_URL) return `${S3_CDN_URL}/${file.path}`;
  return S3Util.getFileUrl(file.path);
}

/**
 * Buyer wishlists.
 *
 * `Wishlists` / `WishlistItems` existed with no endpoint between them. See
 * FLAGS.md CAT-7.
 *
 * One wishlist per buyer (`Wishlists.buyerId` is unique), created lazily the
 * first time something is saved — an empty row for every buyer who never used
 * the feature buys nothing.
 */
export default class WishlistService {
  private static async resolveBuyerId(userId: string) {
    const buyer = await prisma.buyers.findUnique({ where: { userId } });
    if (!buyer) throw { status: 403, message: 'Only registered buyers can use a wishlist.' };
    return buyer.id;
  }

  /** The caller's wishlist with its products. Returns an empty list, never 404. */
  static async getWishlist(userId: string) {
    const buyerId = await this.resolveBuyerId(userId);

    const wishlist = await prisma.wishlists.findUnique({
      where: { buyerId },
      include: {
        items: {
          orderBy: { createdAt: 'desc' },
          include: {
            product: {
              select: {
                id: true,
                name: true,
                price: true,
                brand: true,
                isActive: true,
                ratingAverage: true,
                ratingCount: true,
                storeId: true,
                productImages: {
                  where: { isPrimary: true },
                  take: 1,
                  select: { file: { select: { path: true } } },
                },
              },
            },
            variant: { select: { id: true, variantName: true, price: true } },
          },
        },
      },
    });

    const rawItems = wishlist?.items ?? [];
    const items = await Promise.all(
      rawItems.map(async (item) => ({
        ...item,
        product: {
          ...item.product,
          productImages: await Promise.all(
            (item.product?.productImages ?? []).map(async (pi) => ({
              ...pi,
              file: { ...pi.file, url: await resolveImageUrl(pi.file) },
            })),
          ),
        },
      })),
    );
    return { id: wishlist?.id ?? null, items, count: items.length };
  }

  /**
   * Save a product. Idempotent — saving something already saved is a no-op
   * rather than an error, because from the buyer's side it is already done.
   */
  static async addItem(userId: string, productId: string, variantId?: string) {
    const buyerId = await this.resolveBuyerId(userId);

    const product = await prisma.products.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) throw { status: 404, message: 'Product not found.' };

    const wishlist = await prisma.wishlists.upsert({
      where: { buyerId },
      create: { buyerId },
      update: {},
    });

    const existing = await prisma.wishlistItems.findFirst({
      where: { wishlistId: wishlist.id, productId, variantId: variantId ?? null },
    });
    if (existing) return existing;

    return prisma.wishlistItems.create({
      data: { wishlistId: wishlist.id, productId, variantId: variantId ?? null },
    });
  }

  /** Remove by product, so a client does not need to know the item id. */
  static async removeItem(userId: string, productId: string, variantId?: string) {
    const buyerId = await this.resolveBuyerId(userId);

    const wishlist = await prisma.wishlists.findUnique({ where: { buyerId } });
    if (!wishlist) return { removed: 0 };

    const result = await prisma.wishlistItems.deleteMany({
      where: { wishlistId: wishlist.id, productId, ...(variantId ? { variantId } : {}) },
    });

    return { removed: result.count };
  }

  /**
   * Whether a set of products is saved, for rendering the heart on a product
   * grid without one request per card.
   */
  static async getSavedProductIds(userId: string, productIds: string[]) {
    const buyerId = await this.resolveBuyerId(userId);

    const wishlist = await prisma.wishlists.findUnique({ where: { buyerId } });
    if (!wishlist) return [];

    const items = await prisma.wishlistItems.findMany({
      where: {
        wishlistId: wishlist.id,
        ...(productIds.length ? { productId: { in: productIds } } : {}),
      },
      select: { productId: true },
    });

    return [...new Set(items.map((item) => item.productId))];
  }

  static async clear(userId: string) {
    const buyerId = await this.resolveBuyerId(userId);

    const wishlist = await prisma.wishlists.findUnique({ where: { buyerId } });
    if (!wishlist) return { removed: 0 };

    const result = await prisma.wishlistItems.deleteMany({ where: { wishlistId: wishlist.id } });
    return { removed: result.count };
  }
}
