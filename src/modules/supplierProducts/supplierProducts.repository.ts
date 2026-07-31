import { prisma } from '../../utils/prisma';
import { Prisma } from '@prisma/client';

export class SupplierProductsRepository {
  static async create(data: Prisma.SupplierProductsCreateInput) {
    return prisma.supplierProducts.create({
      data,
      include: {
        seller: true,
        product: true,
      },
    });
  }

  static async findBySellerId(sellerId: string) {
    return prisma.supplierProducts.findMany({
      where: { sellerId },
      include: {
        product: true,
      },
    });
  }

  static async findByProductId(productId: string) {
    return prisma.supplierProducts.findMany({
      where: { productId },
      include: {
        seller: true,
      },
    });
  }

  static async update(id: string, data: Prisma.SupplierProductsUpdateInput) {
    return prisma.supplierProducts.update({
      where: { id },
      data,
    });
  }

  static async delete(id: string) {
    return prisma.supplierProducts.delete({
      where: { id },
    });
  }
}

export default SupplierProductsRepository;
