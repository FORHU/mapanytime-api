import { prisma } from '../../utils/prisma';

export default class InventoryRepository {
  static async restock(productId: string, addedQuantity: number) {
    return prisma.inventory.updateMany({
      where: { productId: productId },
      data: {
        quantityOnHand: { increment: addedQuantity },
      },
    });
  }

  /**
   * Sets an absolute target stock level for a product's inventory row. The
   * delta is computed here (server-side) and applied transactionally with an
   * audit row, so both increases and decreases are safe and traceable.
   */
  static async adjust(productId: string, targetQuantity: number, userId: string) {
    return prisma.$transaction(async (tx) => {
      const inventory = await tx.inventory.findFirst({
        where: { productId },
        select: { id: true, storeId: true, quantityOnHand: true },
      });
      if (!inventory) {
        throw { status: 404, message: 'Inventory record not found for this product.' };
      }

      const newOnHand = Math.max(0, Math.floor(targetQuantity));
      const delta = newOnHand - inventory.quantityOnHand;

      if (delta !== 0) {
        await tx.inventory.update({
          where: { id: inventory.id },
          data: { quantityOnHand: newOnHand },
        });

        await tx.inventoryMovements.create({
          data: {
            inventoryId: inventory.id,
            productId,
            storeId: inventory.storeId,
            movementType: 'ADJUSTMENT',
            quantityDelta: delta,
            previousOnHand: inventory.quantityOnHand,
            newOnHand,
            referenceType: 'MANUAL_ADJUSTMENT',
            note: `Manual adjustment to ${targetQuantity} units`,
            createdById: userId,
          },
        });
      }

      return { productId, quantityOnHand: newOnHand, changed: delta !== 0 };
    });
  }

  static async getInventoryByProductId(productId: string) {
    return prisma.inventory.findFirst({
      where: { productId },
      select: {
        productId: true,
        quantityOnHand: true,
        updatedAt: true,
      },
    });
  }
}
