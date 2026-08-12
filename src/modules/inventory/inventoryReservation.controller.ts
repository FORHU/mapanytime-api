import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import InventoryReservationService from './inventoryReservation.service';
import { responseSuccess, responseError, ErrorStatus } from '../../helpers/response.helper';

export default class InventoryReservationController {
  /**
   * Reserve stock for checkout.
   */
  static async reserve(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      inventoryId: Joi.string().required(),
      quantity: Joi.number().integer().min(1).required(),
      ttlMinutes: Joi.number().integer().min(1).max(120).optional().default(15),
      cartId: Joi.string().optional(),
      orderId: Joi.string().optional(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const buyerId = (req.user as { id: string })?.id;
      if (!buyerId) return responseError(res, 401, 'Unauthorized access.');

      const reservation = await InventoryReservationService.reserveStock(
        buyerId,
        value.inventoryId,
        value.quantity,
        value.ttlMinutes,
        value.cartId,
        value.orderId,
      );

      return responseSuccess(res, 201, reservation, 'Stock reserved successfully.');
    } catch (error) {
      const err = error as { status?: ErrorStatus; message?: string };
      if (err.status) {
        return responseError(res, err.status, err.message || 'Failed to reserve stock.');
      }
      next(error);
    }
  }

  /**
   * Get active non-expired reservations for authenticated user.
   */
  static async getActiveReservations(req: Request, res: Response, next: NextFunction) {
    try {
      const buyerId = (req.user as { id: string })?.id;
      if (!buyerId) return responseError(res, 401, 'Unauthorized access.');

      const reservations = await InventoryReservationService.getActiveReservations(buyerId);
      return responseSuccess(res, 200, reservations, 'Active reservations retrieved successfully.');
    } catch (error) {
      const err = error as { status?: ErrorStatus; message?: string };
      if (err.status) {
        return responseError(res, err.status, err.message || 'Failed to retrieve reservations.');
      }
      next(error);
    }
  }

  /**
   * Confirm reservation on successful payment.
   */
  static async confirm(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      orderId: Joi.string().required(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const { id } = req.params;
      const reservation = await InventoryReservationService.confirmReservation(id, value.orderId);
      return responseSuccess(res, 200, reservation, 'Reservation confirmed successfully.');
    } catch (error) {
      const err = error as { status?: ErrorStatus; message?: string };
      if (err.status) {
        return responseError(res, err.status, err.message || 'Failed to confirm reservation.');
      }
      next(error);
    }
  }

  /**
   * Release reservation manually.
   */
  static async release(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const reservation = await InventoryReservationService.releaseReservation(id);
      return responseSuccess(res, 200, reservation, 'Reservation released successfully.');
    } catch (error) {
      const err = error as { status?: ErrorStatus; message?: string };
      if (err.status) {
        return responseError(res, err.status, err.message || 'Failed to release reservation.');
      }
      next(error);
    }
  }
}
