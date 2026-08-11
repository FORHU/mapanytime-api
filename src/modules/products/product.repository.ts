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

  static async getProductsByStoreId(storeId: string) {
    const products = await prisma.products.findMany({
      where: { storeId: storeId, isActive: true },
      include: {
        category: true,
        tags: true,
        inventory: true,
        productImages: {
          include: { file: { select: { path: true, bucket: true } } },
          orderBy: { displayOrder: 'asc' },
        },
      },
    });

    return Promise.all(
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
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.products.count({ where }),
    ]);

    const resolved = await Promise.all(
      items.map(async (product) => ({
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

    return { items: resolved, total };
  }
}
