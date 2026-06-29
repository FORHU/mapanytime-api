import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';

export default class ProductRepository {
  static async getStoreByUserId(userId: string) {
    return prisma.sellers.findUnique({
      where: { userId: userId },
      // CHANGED: Fetches the array of stores instead of a singular store
      include: { stores: true },
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
}
