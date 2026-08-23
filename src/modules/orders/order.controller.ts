import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import OrderService from './order.service';
import CartService from '../cart/cart.service';
import { responseSuccess, responseError } from '../../helpers/response.helper';
import { parsePagination } from '../../helpers/pagination.helper';
import { prisma } from '../../utils/prisma';
import RedisUtil from '../../utils/redis.util';
import { FULLFILLMENTTYPE } from '@prisma/client';

export default class OrderController {
  static async create(req: Request, res: Response, next: NextFunction) {
    const idempotencyKey = (req.headers['idempotency-key'] || req.headers['idempotency_key']) as
      string | undefined;
    if (idempotencyKey && RedisUtil.client?.isOpen) {
      try {
        const cachedOrder = await RedisUtil.client.get(`idempotency:order:${idempotencyKey}`);
        if (cachedOrder) {
          return responseSuccess(
            res,
            200,
            JSON.parse(cachedOrder),
            'Order retrieved successfully (idempotent duplicate request)',
          );
        }
      } catch (e) {
        // Continue to create order if redis get fails
      }
    }

    const schema = Joi.object({
      type: Joi.string()
        .valid(...Object.values(FULLFILLMENTTYPE))
        .required(),
      paymentMethod: Joi.string().optional(),
      paymentMethodId: Joi.string().optional(),
      productIds: Joi.array().items(Joi.string()).min(1).optional(),
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

      let buyer = await prisma.buyers.findUnique({
        where: { userId: userId },
      });

      if (!buyer) {
        const user = await prisma.users.findUnique({ where: { id: userId } });
        const displayName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'Buyer';
        buyer = await prisma.buyers.create({
          data: { userId: userId, displayName },
        });
      }

      const cart = await CartService.getCart(userId);

      if (!cart || !cart.storeId || cart.items.length === 0) {
        return responseError(res, 400, 'Your checkout failed because your cart is empty.');
      }

      let itemsToOrder = cart.items;
      if (value.productIds && value.productIds.length > 0) {
        const productSet = new Set(value.productIds as string[]);
        itemsToOrder = cart.items.filter((item: { productId: string }) =>
          productSet.has(item.productId),
        );
        if (itemsToOrder.length === 0) {
          return responseError(res, 400, 'None of the selected items are currently in your cart.');
        }
      }

      const servicePayload = {
        buyerId: buyer.id,
        storeId: cart.storeId,
        type: value.type,
        paymentMethod: value.paymentMethod,
        pickupAt: value.pickupAt as Date | undefined,
        items: itemsToOrder,
      };

      const data = await OrderService.createOrder(servicePayload);

      if (value.productIds && value.productIds.length > 0) {
        await CartService.removeItems(userId, value.productIds);
      } else {
        await CartService.clearCart(userId);
      }

      if (idempotencyKey && RedisUtil.client?.isOpen) {
        try {
          await RedisUtil.client.setEx(
            `idempotency:order:${idempotencyKey}`,
            86400,
            JSON.stringify(data),
          );
        } catch (e) {
          // Non-blocking caching failure
        }
      }

      return responseSuccess(res, 201, data, 'Order created successfully');
    } catch (error) {
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
      return responseSuccess(res, 200, data, 'Order marked as completed');
    } catch (error) {
      const err = error as { status?: Parameters<typeof responseError>[1]; message?: string };

      if (err.status) {
        return responseError(res, err.status, err.message || 'An error occurred');
      }
      next(error);
    }
  }

  static async generateCashPickupCode(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      orderId: Joi.string().required(),
      storeId: Joi.string().required(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized access.');

      const data = await OrderService.generateCashPickupCode(userId, value.orderId, value.storeId);
      return responseSuccess(res, 200, data, 'Pickup confirmation code generated');
    } catch (error) {
      const err = error as { status?: Parameters<typeof responseError>[1]; message?: string };

      if (err.status) {
        return responseError(res, err.status, err.message || 'An error occurred');
      }
      next(error);
    }
  }

  static async confirmCashPickup(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      orderId: Joi.string().required(),
      code: Joi.string().required(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized access.');

      const data = await OrderService.confirmCashPickup(userId, value.orderId, value.code);
      return responseSuccess(res, 200, data, 'Order marked as completed');
    } catch (error) {
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
      const err = error as { status?: Parameters<typeof responseError>[1]; message?: string };

      if (err.status) {
        return responseError(res, err.status, err.message || 'An error occurred');
      }
      next(error);
    }
  }

  static async myOrders(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized access.');

      const data = await OrderService.getMyOrders(userId);
      return responseSuccess(res, 200, data, 'Buyer orders retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  /** Platform-wide orders for the admin console. Gated by `requireAdmin`. */
  static async allOrders(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      status: Joi.string()
        .valid('PENDING', 'PROCESSING', 'READY_FOR_PICKUP', 'COMPLETED', 'CANCELLED', 'FAILED')
        .optional(),
      search: Joi.string().trim().allow('').max(200).optional(),
      sortOrder: Joi.string().valid('asc', 'desc').optional(),
    }).unknown(true);

    const { error, value } = schema.validate(req.query);
    if (error) return responseError(res, 400, error.message);

    try {
      const { page, limit, skip } = parsePagination(req.query as Record<string, unknown>);

      const data = await OrderService.getAllOrders({
        status: value.status,
        search: value.search,
        sortOrder: value.sortOrder,
        page,
        limit,
        skip,
      });
      return responseSuccess(res, 200, data, 'Orders retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  static async storeOrders(req: Request, res: Response, next: NextFunction) {
    // page/limit/sortOrder are normalized by parsePagination; status/search
    // are validated here. Unknown keys (e.g. page/limit) pass through.
    const schema = Joi.object({
      storeId: Joi.string().optional(),
      status: Joi.string()
        .valid('PENDING', 'PROCESSING', 'READY_FOR_PICKUP', 'COMPLETED', 'CANCELLED', 'FAILED')
        .optional(),
      search: Joi.string().trim().allow('').max(200).optional(),
      sortOrder: Joi.string().valid('asc', 'desc').optional(),
    }).unknown(true);

    const { error, value } = schema.validate(req.query);
    if (error) return responseError(res, 400, error.message);

    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized access.');

      const { page, limit, skip } = parsePagination(req.query as Record<string, unknown>);

      const data = await OrderService.getStoreOrders(userId, value.storeId, {
        status: value.status,
        search: value.search,
        sortOrder: value.sortOrder,
        page,
        limit,
        skip,
      });
      return responseSuccess(res, 200, data, 'Store orders retrieved successfully');
    } catch (error) {
      const err = error as { status?: Parameters<typeof responseError>[1]; message?: string };
      if (err.status) {
        return responseError(res, err.status, err.message || 'An error occurred');
      }
      next(error);
    }
  }

  static async storeOrderStats(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized access.');

      const storeId = req.query.storeId as string | undefined;

      const data = await OrderService.getStoreOrderStats(userId, storeId);
      return responseSuccess(res, 200, data, 'Store order stats retrieved successfully');
    } catch (error) {
      const err = error as { status?: Parameters<typeof responseError>[1]; message?: string };
      if (err.status) {
        return responseError(res, err.status, err.message || 'An error occurred');
      }
      next(error);
    }
  }

  static async updateFulfillmentStatus(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      orderId: Joi.string().required(),
      status: Joi.string().required(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized access.');

      const data = await OrderService.updateFulfillmentStatus(userId, value.orderId, value.status);
      return responseSuccess(res, 200, data, 'Fulfillment status updated successfully');
    } catch (error) {
      const err = error as { status?: Parameters<typeof responseError>[1]; message?: string };
      if (err.status) {
        return responseError(res, err.status, err.message || 'An error occurred');
      }
      next(error);
    }
  }
}
