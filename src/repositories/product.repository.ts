import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';

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
    return prisma.products.findMany({
      where: { storeId: storeId },
      include: { category: true, tags: true },
    });
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
          tags: true,
          store: { select: { id: true, storeName: true } },
          productFile: { select: { fileUrl: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.products.count({ where }),
    ]);

    return { items, total };
  }
}
