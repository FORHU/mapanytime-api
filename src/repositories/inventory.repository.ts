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
}
