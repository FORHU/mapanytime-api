import { Prisma } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import { S3_CDN_URL } from '../../config';
import S3Util from '../../utils/s3.util';

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

  static async createProduct(data: Prisma.ProductsCreateInput) {
    return prisma.products.create({
      data,
    });
  }

  static async getMyProducts(
    storeId: string | undefined,
    sellerId: string,
    opts: {
      skip: number;
      take: number;
      search?: string;
      categoryId?: string;
      sortBy?: 'price' | 'name' | 'createdAt';
      sortOrder?: 'asc' | 'desc';
    } = { skip: 0, take: 100 },
  ) {
    const term = opts.search?.trim();

    const where: Prisma.ProductsWhereInput = {
      ...(storeId ? { storeId } : { store: { sellerId } }),
      isActive: true,
      ...(opts.categoryId ? { categoryId: opts.categoryId } : {}),
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
          tags: true,
          inventory: true,
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

  static async getProductById(productId: string) {
    return prisma.products.findUnique({
      where: { id: productId },
    });
  }

  static async updateProduct(productId: string, data: Prisma.ProductsUpdateInput) {
    return prisma.products.update({
      where: { id: productId },
      data,
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
          store: { select: { id: true, storeName: true } },
          productImages: {
            where: { isPrimary: true },
            include: { file: { select: { path: true, bucket: true } } },
            take: 1,
          },
          merchantAdLinks: {
            where: {
              ad: {
                isActive: true,
                discountType: { not: null },
                OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
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
