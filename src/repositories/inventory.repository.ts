import { prisma } from '../utils/prisma';

export default class InventoryRepository {
  static async restock(productId: string, addedQuantity: number) {
    return prisma.inventory.update({
      where: { productId: productId },
      data: {
        quantityOnHand: { increment: addedQuantity },
      },
    });
  }

  static async getInventoryByProductId(productId: string) {
    return prisma.inventory.findUnique({
      where: { productId },
      select: {
        productId: true,
        quantityOnHand: true,
        updatedAt: true,
      },
    });
  }
}
