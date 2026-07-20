import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import OrderService from '../services/order.service';
import CartService from '../services/cart.service';
import { responseSuccess, responseError } from '../helpers/response.helper';
import { prisma } from '../utils/prisma';
import { PAYMENTMETHOD, FULLFILLMENTTYPE } from '@prisma/client';

export default class OrderController {
  static async create(req: Request, res: Response, next: NextFunction) {
    // Validate only the fulfillment details from the frontend
    const schema = Joi.object({
      type: Joi.string().valid(...Object.values(FULLFILLMENTTYPE)).required(),
      paymentMethod: Joi.string().valid(...Object.values(PAYMENTMETHOD)).required(),
      // Buyer-set scheduled pickup time (ISO 8601, must be in the future).
      // Required for PICKUP orders; ignored/optional for DELIVERY.
      pickupAt: Joi.date()
        .iso()
        .greater('now')
        .when('type', { is: 'PICKUP', then: Joi.required(), otherwise: Joi.optional() }),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized access.');

      const buyer = await prisma.buyers.findUnique({
        where: { userId: userId },
      });

      if (!buyer) {
        return responseError(res, 403, 'Only registered buyers can create orders.');
      }

      // Retrieve the trusted storeId and items from the Redis server cache
      const cart = await CartService.getCart(userId);

      if (!cart || !cart.storeId || cart.items.length === 0) {
        return responseError(res, 400, 'Your checkout failed because your cart is empty.');
      }

      // Construct the payload safely on the backend
      const servicePayload = {
        buyerId: buyer.id,
        storeId: cart.storeId, // Pulled from Redis
        type: value.type,
        paymentMethod: value.paymentMethod,
        pickupAt: value.pickupAt as Date | undefined,
        items: cart.items, // Pulled from Redis
      };

      const data = await OrderService.createOrder(servicePayload);

      // Clear the cart after successful creation
      await CartService.clearCart(userId);

      return responseSuccess(res, 201, data, 'Order created successfully');
    } catch (error) {
      // Dynamically extract the exact status type expected by responseError
      const err = error as { status?: Parameters<typeof responseError>[1]; message?: string };

      if (err.status) {
        return responseError(res, err.status, err.message || 'An error occurred');
      }
      next(error);
    }
  }

  static async complete(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      orderId: Joi.string().required(),
      storeId: Joi.string().required(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized access.');

      const data = await OrderService.completeOrder(userId, value.orderId, value.storeId);
      return responseSuccess(res, 200, data, 'Order has been fulfilled successfully');
    } catch (error) {
      // Dynamically extract the exact status type expected by responseError
      const err = error as { status?: Parameters<typeof responseError>[1]; message?: string };

      if (err.status) {
        return responseError(res, err.status, err.message || 'An error occurred');
      }
      next(error);
    }
  }

  static async cancel(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      orderId: Joi.string().required(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized access.');

      const data = await OrderService.cancelOrder(userId, value.orderId);
      return responseSuccess(res, 200, data, 'Order cancelled successfully');
    } catch (error) {
      // Dynamically extract the exact status type expected by responseError
      const err = error as { status?: Parameters<typeof responseError>[1]; message?: string };

      if (err.status) {
        return responseError(res, err.status, err.message || 'An error occurred');
      }
      next(error);
    }
  }

  static async getOrders(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized access.');

      const data = await OrderService.getMyOrders(userId);
      return responseSuccess(res, 200, data, 'Orders fetched successfully');
    } catch (error) {
      const err = error as { status?: Parameters<typeof responseError>[1]; message?: string };
      if (err.status) {
        return responseError(res, err.status, err.message || 'An error occurred');
      }
      next(error);
    }
  }
}
