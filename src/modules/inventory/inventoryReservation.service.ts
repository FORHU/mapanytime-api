import InventoryReservationRepository from './inventoryReservation.repository';
import { prisma } from '../../utils/prisma';
import logger from '../../utils/logger';

let sweeper: NodeJS.Timeout | null = null;

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

    // The 15-minute default is the pre-checkout cart hold. Once an order
    // exists, `OrderService` sets the expiry from the booked pickup slot
    // instead — see `resolveReservationExpiry` there and FIX-PLAN.md item 14.
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
   * When `userId` is provided, ensures the caller owns the reservation.
   */
  static async releaseReservation(reservationId: string, userId?: string) {
    if (userId) {
      const buyerId = await this.resolveBuyerId(userId);
      const reservation = await InventoryReservationRepository.findReservationById(reservationId);
      if (!reservation) {
        throw { status: 404, message: 'Reservation not found.' };
      }
      if (reservation.buyerId !== buyerId) {
        throw { status: 403, message: 'You are not authorized to release this reservation.' };
      }
    }

    try {
      return await InventoryReservationRepository.releaseReservation(reservationId);
    } catch (error) {
      const err = error as { status?: number; message?: string };
      if (err.status) throw err;
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

  /**
   * Periodic background sweeper to release expired reservations (F91).
   */
  static startSweeper(intervalMs = 60_000) {
    if (sweeper) return;
    sweeper = setInterval(() => {
      InventoryReservationService.processExpiredReservations()
        .then((count) => {
          if (count > 0) {
            logger.info(`[ReservationSweeper] Released ${count} expired stock reservation(s).`);
          }
        })
        .catch((err) => {
          logger.warn(
            `[ReservationSweeper] Sweep failed: ${(err as { message?: string }).message}`,
          );
        });
    }, intervalMs);
    sweeper.unref();
  }

  static stopSweeper() {
    if (sweeper) clearInterval(sweeper);
    sweeper = null;
  }
}
