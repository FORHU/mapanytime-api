import InventoryReservationRepository from './inventoryReservation.repository';
import { prisma } from '../../utils/prisma';

export default class InventoryReservationService {
  /**
   * `InventoryReservations.buyerId` is a `Buyers` id, but callers authenticate
   * as a `Users` row — passing the user id straight through violates the
   * foreign key. Resolve the buyer profile first, as OrderService does.
   */
  private static async resolveBuyerId(userId: string) {
    const buyer = await prisma.buyers.findUnique({ where: { userId } });
    if (!buyer) {
      throw { status: 403, message: 'Only registered buyers can reserve stock.' };
    }
    return buyer.id;
  }

  /**
   * Reserve stock for a specified TTL (default 15 minutes).
   */
  static async reserveStock(
    userId: string,
    inventoryId: string,
    quantity: number,
    ttlMinutes: number = 15,
    cartId?: string,
    orderId?: string,
  ) {
    if (quantity <= 0) {
      throw { status: 400, message: 'Quantity to reserve must be greater than zero.' };
    }

    const buyerId = await this.resolveBuyerId(userId);
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

    try {
      return await InventoryReservationRepository.createReservation({
        inventoryId,
        buyerId,
        quantity,
        expiresAt,
        cartId,
        orderId,
      });
    } catch (error) {
      const err = error as { message?: string };
      throw { status: 400, message: err.message || 'Failed to reserve stock.' };
    }
  }

  /**
   * Confirm reservation upon successful payment or checkout completion.
   */
  static async confirmReservation(reservationId: string, orderId: string) {
    try {
      return await InventoryReservationRepository.consumeReservation(reservationId, orderId);
    } catch (error) {
      const err = error as { message?: string };
      throw { status: 400, message: err.message || 'Failed to confirm stock reservation.' };
    }
  }

  /**
   * Explicitly release a reservation (e.g. buyer abandoned checkout).
   */
  static async releaseReservation(reservationId: string) {
    try {
      return await InventoryReservationRepository.releaseReservation(reservationId);
    } catch (error) {
      const err = error as { message?: string };
      throw { status: 400, message: err.message || 'Failed to release reservation.' };
    }
  }

  /**
   * Scans and releases expired stock reservations.
   */
  static async processExpiredReservations() {
    return InventoryReservationRepository.expireStaleReservations();
  }

  /**
   * Get active non-expired reservations for the authenticated user's buyer
   * profile.
   */
  static async getActiveReservations(userId: string) {
    const buyerId = await this.resolveBuyerId(userId);
    return InventoryReservationRepository.findActiveReservationsByBuyer(buyerId);
  }
}
