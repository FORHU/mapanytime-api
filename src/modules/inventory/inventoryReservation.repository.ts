import { ORDERSTATUS, RESERVATIONSTATUS } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import InventoryStockRepository from './inventoryStock.repository';

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

      // The availability test and the increment have to be one statement, or
      // two callers racing for the last unit both pass the test (F75). The
      // quantity reported back is the pre-attempt read, which is good enough
      // for the message.
      const reserved = await InventoryStockRepository.tryReserve(
        tx,
        data.inventoryId,
        data.quantity,
      );
      if (!reserved) {
        const availableQuantity = inventory.quantityOnHand - inventory.quantityReserved;
        throw new Error(
          `Insufficient stock available for reservation. Available: ${availableQuantity}, Requested: ${data.quantity}`,
        );
      }

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

      // Claim the hold before touching stock. The status test above is a read,
      // and the TTL sweeper can expire this row in between — consuming it then
      // would decrement a reservation that had already been given back.
      const claimed = await InventoryStockRepository.claimReservation(
        tx,
        reservationId,
        RESERVATIONSTATUS.CONSUMED,
      );
      if (!claimed) {
        throw new Error(`Cannot consume reservation ${reservationId}; its hold has already ended.`);
      }

      // The sale takes the goods off the shelf and ends the hold together.
      const updatedInventory = await tx.inventory.update({
        where: { id: inv.id },
        data: {
          quantityOnHand: { decrement: claimed.quantity },
          quantityReserved: { decrement: claimed.quantity },
          version: { increment: 1 },
        },
      });
      const newOnHand = updatedInventory.quantityOnHand;
      const previousOnHand = newOnHand + claimed.quantity;

      const updatedReservation = await tx.inventoryReservations.update({
        where: { id: reservationId },
        data: { orderId: orderId },
      });

      // Audit movement
      await tx.inventoryMovements.create({
        data: {
          inventoryId: inv.id,
          productId: inv.productId,
          variantId: inv.variantId,
          storeId: inv.storeId,
          movementType: 'SALE',
          quantityDelta: -claimed.quantity,
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

      // The status flip is the claim, so a hold the TTL sweeper released a
      // moment ago is not credited back a second time (F43). Releasing an
      // already-ended reservation stays a no-op that returns the row.
      await InventoryStockRepository.releaseReservation(
        tx,
        reservationId,
        RESERVATIONSTATUS.RELEASED,
      );

      return tx.inventoryReservations.findUniqueOrThrow({ where: { id: reservationId } });
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
        // A hold on a paid order belongs to the buyer until the goods are
        // handed over, however late they are to collect — expiring it would
        // put stock they have already paid for back on sale, and the seller
        // could then sell the same unit twice.
        //
        // This guard is load-bearing only since payment stopped marking holds
        // CONSUMED (F90). Before that, a paid order's rows were invisible here
        // by accident. Cart holds (no order) and unpaid orders are fair game;
        // CANCELLED, FAILED and COMPLETED orders release their own holds, so
        // anything still RESERVED against those is leftovers worth sweeping.
        OR: [
          { orderId: null },
          {
            order: {
              status: { notIn: [ORDERSTATUS.PROCESSING, ORDERSTATUS.READY_FOR_PICKUP] },
            },
          },
        ],
      },
    });

    let expiredCount = 0;
    for (const res of staleReservations) {
      try {
        // Re-claimed inside the transaction rather than trusted from the read
        // above: between the two, a checkout can consume the reservation or a
        // cancel can release it, and expiring it again would credit the stock
        // twice. A row someone else took releases 0 and is not counted.
        const released = await prisma.$transaction((tx) =>
          InventoryStockRepository.releaseReservation(tx, res.id, RESERVATIONSTATUS.EXPIRED),
        );
        if (released > 0) expiredCount++;
      } catch (err) {
        console.error(`Failed to expire reservation ${res.id}:`, err);
      }
    }

    return expiredCount;
  }
}
