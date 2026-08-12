import { RESERVATIONSTATUS } from '@prisma/client';
import { prisma } from '../../utils/prisma';

export default class InventoryReservationRepository {
  /**
   * Atomically reserve inventory if available stock (quantityOnHand - quantityReserved) >= requested quantity.
   */
  static async createReservation(data: {
    inventoryId: string;
    buyerId: string;
    quantity: number;
    expiresAt: Date;
    cartId?: string;
    orderId?: string;
  }) {
    return prisma.$transaction(async (tx) => {
      const inventory = await tx.inventory.findUnique({
        where: { id: data.inventoryId },
      });

      if (!inventory) {
        throw new Error('Inventory record not found.');
      }

      const availableQuantity = inventory.quantityOnHand - inventory.quantityReserved;
      if (availableQuantity < data.quantity) {
        throw new Error(
          `Insufficient stock available for reservation. Available: ${availableQuantity}, Requested: ${data.quantity}`,
        );
      }

      // Increment quantityReserved
      await tx.inventory.update({
        where: { id: data.inventoryId },
        data: {
          quantityReserved: { increment: data.quantity },
        },
      });

      // Create reservation record
      return tx.inventoryReservations.create({
        data: {
          inventoryId: data.inventoryId,
          buyerId: data.buyerId,
          quantity: data.quantity,
          expiresAt: data.expiresAt,
          cartId: data.cartId,
          orderId: data.orderId,
          status: RESERVATIONSTATUS.RESERVED,
        },
      });
    });
  }

  static async findReservationById(id: string) {
    return prisma.inventoryReservations.findUnique({
      where: { id },
      include: { inventory: true },
    });
  }

  static async findActiveReservationsByBuyer(buyerId: string) {
    return prisma.inventoryReservations.findMany({
      where: {
        buyerId,
        status: RESERVATIONSTATUS.RESERVED,
        expiresAt: { gt: new Date() },
      },
      include: { inventory: true },
    });
  }

  /**
   * Convert an active reservation into a completed sale upon payment success.
   * Atomically decrements quantityOnHand & quantityReserved, updates reservation status, and logs InventoryMovement.
   */
  static async consumeReservation(reservationId: string, orderId: string) {
    return prisma.$transaction(async (tx) => {
      const reservation = await tx.inventoryReservations.findUnique({
        where: { id: reservationId },
        include: { inventory: true },
      });

      if (!reservation) {
        throw new Error('Reservation not found.');
      }

      if (reservation.status !== RESERVATIONSTATUS.RESERVED) {
        throw new Error(`Cannot consume reservation with status '${reservation.status}'.`);
      }

      const inv = reservation.inventory;
      const previousOnHand = inv.quantityOnHand;
      const newOnHand = previousOnHand - reservation.quantity;

      // Decrement both on-hand and reserved
      await tx.inventory.update({
        where: { id: inv.id },
        data: {
          quantityOnHand: { decrement: reservation.quantity },
          quantityReserved: { decrement: reservation.quantity },
        },
      });

      // Update reservation status
      const updatedReservation = await tx.inventoryReservations.update({
        where: { id: reservationId },
        data: {
          status: RESERVATIONSTATUS.CONSUMED,
          orderId: orderId,
        },
      });

      // Audit movement
      await tx.inventoryMovements.create({
        data: {
          inventoryId: inv.id,
          productId: inv.productId,
          variantId: inv.variantId,
          storeId: inv.storeId,
          movementType: 'SALE',
          quantityDelta: -reservation.quantity,
          previousOnHand: previousOnHand,
          newOnHand: newOnHand,
          referenceId: orderId,
          referenceType: 'ORDER',
          note: `Consumed reservation ${reservationId} for order ${orderId}`,
        },
      });

      return updatedReservation;
    });
  }

  /**
   * Release an active reservation (e.g. buyer cancelled checkout).
   */
  static async releaseReservation(reservationId: string) {
    return prisma.$transaction(async (tx) => {
      const reservation = await tx.inventoryReservations.findUnique({
        where: { id: reservationId },
      });

      if (!reservation) {
        throw new Error('Reservation not found.');
      }

      if (reservation.status !== RESERVATIONSTATUS.RESERVED) {
        return reservation; // Already released/consumed/expired
      }

      await tx.inventory.update({
        where: { id: reservation.inventoryId },
        data: {
          quantityReserved: { decrement: reservation.quantity },
        },
      });

      return tx.inventoryReservations.update({
        where: { id: reservationId },
        data: {
          status: RESERVATIONSTATUS.RELEASED,
        },
      });
    });
  }

  /**
   * Batch release/expire stale reservations past their TTL expiresAt timestamp.
   */
  static async expireStaleReservations() {
    const staleReservations = await prisma.inventoryReservations.findMany({
      where: {
        status: RESERVATIONSTATUS.RESERVED,
        expiresAt: { lte: new Date() },
      },
    });

    let expiredCount = 0;
    for (const res of staleReservations) {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.inventory.update({
            where: { id: res.inventoryId },
            data: {
              quantityReserved: { decrement: res.quantity },
            },
          });

          await tx.inventoryReservations.update({
            where: { id: res.id },
            data: {
              status: RESERVATIONSTATUS.EXPIRED,
            },
          });
        });
        expiredCount++;
      } catch (err) {
        console.error(`Failed to expire reservation ${res.id}:`, err);
      }
    }

    return expiredCount;
  }
}
