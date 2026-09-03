import { Prisma } from '@prisma/client';
import { prisma } from '../../utils/prisma';

export const PRODUCT_OPTIONS_INCLUDE = {
  orderBy: { position: 'asc' },
  select: {
    id: true,
    name: true,
    position: true,
    values: {
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, value: true },
    },
  },
} satisfies Prisma.Products$optionsArgs;
import { S3_CDN_URL } from '../../config';
import S3Util from '../../utils/s3.util';
import { liveWindowFilter } from '../merchantAds/adWindow';

async function resolveImageUrl(file: { path: string; bucket?: string | null }): Promise<string> {
  if (S3_CDN_URL) return `${S3_CDN_URL}/${file.path}`;
  return S3Util.getFileUrl(file.path);
}

export default class ProductRepository {
  static async getSellerByUserId(userId: string) {
    return prisma.sellers.findUnique({
      where: { userId: userId },
    });
  }

  static async getStoreById(storeId: string) {
    return prisma.stores.findUnique({
      where: { id: storeId },
      include: {
        documentVerifications: true,
        seller: true,
      },
    });
  }

  /**
   * `client` lets a caller run this inside an existing transaction â€” product
   * creation writes the product, its inventory row and its images together, and
   * a partial result leaves a product whose stock can never be edited.
   * Same signature shape as `updateProduct` below.
   */
  static async createProduct(
    data: Prisma.ProductsCreateInput,
    client: Prisma.TransactionClient = prisma,
  ) {
    return client.products.create({
      data,
    });
  }

  static async getMyProducts(
    storeScope: Prisma.StoresWhereInput,
    opts: {
      skip: number;
      take: number;
      search?: string;
      categoryIds?: string[];
      sortBy?: 'price' | 'name' | 'createdAt';
      sortOrder?: 'asc' | 'desc';
    } = { skip: 0, take: 100 },
  ) {
    const term = opts.search?.trim();

    const where: Prisma.ProductsWhereInput = {
      store: { is: storeScope },
      isActive: true,
      // Selecting a parent category must also match everything filed beneath it,
      // so the caller passes the pre-expanded descendant set rather than one id.
      ...(opts.categoryIds?.length ? { categoryId: { in: opts.categoryIds } } : {}),
      ...(term
        ? {
            OR: [
              { name: { contains: term, mode: 'insensitive' } },
              { brand: { contains: term, mode: 'insensitive' } },
              { description: { contains: term, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const SORTABLE = ['price', 'name', 'createdAt'] as const;
    type SortableField = (typeof SORTABLE)[number];
    const isSortable = (v: unknown): v is SortableField =>
      typeof v === 'string' && (SORTABLE as readonly string[]).includes(v);
    const sortField: SortableField = isSortable(opts.sortBy) ? opts.sortBy : 'createdAt';
    const sortOrder: Prisma.SortOrder = opts.sortOrder === 'asc' ? 'asc' : 'desc';

    const [products, total] = await Promise.all([
      prisma.products.findMany({
        where,
        include: {
          category: true,
          tags: { include: { tag: true } },
          inventory: true,
          options: PRODUCT_OPTIONS_INCLUDE,
          store: { select: { storeName: true } },
          productImages: {
            include: { file: { select: { path: true, bucket: true } } },
            orderBy: { displayOrder: 'asc' },
          },
        },
        orderBy: { [sortField]: sortOrder },
        skip: opts.skip,
        take: opts.take,
      }),
      prisma.products.count({ where }),
    ]);

    const items = await Promise.all(
      products.map(async (product) => ({
        ...product,
        productImages: await Promise.all(
          product.productImages.map(async (pi) => ({
            ...pi,
            file: {
              ...pi.file,
              url: await resolveImageUrl(pi.file),
            },
          })),
        ),
      })),
    );

    return { items, total };
  }

  /**
   * Which categories the seller actually has products in, with per-category
   * counts. Scoped by the org store-scope â€” for an admin that is every store in
   * the organization, for a staff member only their assigned stores â€” mirroring
   * `getMyProducts`.
   */
  static async getUsedCategoryCounts(storeScope: Prisma.StoresWhereInput) {
    return prisma.products.groupBy({
      by: ['categoryId'],
      where: {
        store: { is: storeScope },
        isActive: true,
        categoryId: { not: null },
      },
      _count: { _all: true },
    });
  }

  static async getProductById(productId: string) {
    return prisma.products.findUnique({
      where: { id: productId },
    });
  }

  /**
   * `client` lets a caller run this inside an existing transaction â€” a product
   * edit changes fields and stock together, and both must land or neither.
   *
   * The include matches what the list endpoint returns so the PUT response is
   * usable; it previously came back without tags, category or inventory, which
   * left the client with nothing to do but rebuild the row locally.
   */
  static async updateProduct(
    productId: string,
    data: Prisma.ProductsUpdateInput,
    client: Prisma.TransactionClient = prisma,
  ) {
    return client.products.update({
      where: { id: productId },
      data,
      include: {
        category: true,
        tags: { include: { tag: true } },
        inventory: true,
        options: PRODUCT_OPTIONS_INCLUDE,
      },
    });
  }

  static async deleteProduct(productId: string) {
    return prisma.products.update({
      where: { id: productId },
      data: { isActive: false },
    });
  }

  static async getAllProducts(filters: {
    storeId?: string;
    categoryIds?: string[];
    search?: string;
    minPrice?: number;
    maxPrice?: number;
    skip: number;
    take: number;
  }) {
    const { storeId, categoryIds, search, minPrice, maxPrice, skip, take } = filters;

    const hasPriceFilter = minPrice !== undefined || maxPrice !== undefined;
    const term = search?.trim();

    const where: Prisma.ProductsWhereInput = {
      // Buyers only see products that are listed/active.
      isActive: true,
      ...(storeId ? { storeId } : {}),
      ...(categoryIds?.length ? { categoryId: { in: categoryIds } } : {}),
      ...(term
        ? {
            OR: [
              { name: { contains: term, mode: 'insensitive' } },
              { brand: { contains: term, mode: 'insensitive' } },
              { description: { contains: term, mode: 'insensitive' } },
              { store: { is: { storeName: { contains: term, mode: 'insensitive' } } } },
            ],
          }
        : {}),
      ...(hasPriceFilter
        ? {
            price: {
              ...(minPrice !== undefined ? { gte: minPrice } : {}),
              ...(maxPrice !== undefined ? { lte: maxPrice } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await prisma.$transaction([
      prisma.products.findMany({
        where,
        include: {
          category: true,
          tags: { include: { tag: true } },
          options: PRODUCT_OPTIONS_INCLUDE,
          store: { select: { id: true, storeName: true } },
          productImages: {
            where: { isPrimary: true },
            include: { file: { select: { path: true, bucket: true } } },
            take: 1,
          },
          merchantAdLinks: {
            where: {
              ad: {
                discountType: { not: null },
                // A scheduled promotion must not badge a product as discounted
                // before it starts â€” same window test as checkout pricing.
                ...liveWindowFilter(),
              },
            },
            include: { ad: true },
            take: 1,
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.products.count({ where }),
    ]);

    const resolved = await Promise.all(
      items.map(async (product) => {
        const { merchantAdLinks, ...rest } = product;
        return {
          ...rest,
          activeAd: merchantAdLinks[0]?.ad ?? null,
          productImages: await Promise.all(
            product.productImages.map(async (pi) => ({
              ...pi,
              file: {
                ...pi.file,
                url: await resolveImageUrl(pi.file),
              },
            })),
          ),
        };
      }),
    );

    return { items: resolved, total };
  }
}
