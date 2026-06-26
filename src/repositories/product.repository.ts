import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';

export default class ProductRepository {
  static async getStoreByUserId(userId: string) {
    return prisma.sellers.findUnique({
      where: { userId: userId },
      include: { store: true },
    });
  }

  static async createProduct(data: Prisma.ProductsUncheckedCreateInput) {
    return prisma.products.create({
      data,
    });
  }

  static async getProductsByStoreId(storeId: string) {
    return prisma.products.findMany({
      where: { storeId: storeId },
    });
  }

  static async getProductById(productId: string) {
    return prisma.products.findUnique({
      where: { id: productId },
    });
  }

  static async updateProduct(productId: string, data: Prisma.ProductsUncheckedUpdateInput) {
    return prisma.products.update({
      where: { id: productId },
      data,
    });
  }

  static async deleteProduct(productId: string) {
    return prisma.products.delete({
      where: { id: productId },
    });
  }
}