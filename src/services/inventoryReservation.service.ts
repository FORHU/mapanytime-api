import InventoryReservationRepository from '../repositories/inventoryReservation.repository';

export default class InventoryReservationService {
  /**
   * Reserve stock for a specified TTL (default 15 minutes).
   */
  static async reserveStock(
    buyerId: string,
    inventoryId: string,
    quantity: number,
    ttlMinutes: number = 15,
    cartId?: string,
    orderId?: string,
  ) {
    if (quantity <= 0) {
      throw { status: 400, message: 'Quantity to reserve must be greater than zero.' };
    }

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
   * Get active non-expired reservations for a buyer.
   */
  static async getActiveReservations(buyerId: string) {
    return InventoryReservationRepository.findActiveReservationsByBuyer(buyerId);
  }
}
