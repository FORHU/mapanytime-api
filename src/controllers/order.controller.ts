import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import OrderService from '../services/order.service';
import { responseSuccess, responseError } from '../helpers/response.helper';
import { prisma } from '../utils/prisma';

export default class OrderController {
  static async create(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      storeId: Joi.string().required(),
      type: Joi.string().valid('DELIVERY', 'PICKUP').required(),
      paymentMethod: Joi.string().valid('BANK', 'GCASH', 'CASH_ON_DELIVERY').required(),
      items: Joi.array()
        .items(
          Joi.object({
            productId: Joi.string().required(),
            quantity: Joi.number().integer().min(1).required(),
          }),
        )
        .min(1)
        .required(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      // Safely extract the root User ID using the pattern from middleware
      const userId = (req.user as { id: string })?.id;

      if (!userId) {
        return responseError(res, 401, 'Unauthorized access.');
      }

      // Fetch the Buyer profile associated with this User account
      const buyer = await prisma.buyers.findUnique({
        where: { userId: userId },
      });

      // Prevent users without a registered Buyer profile from making orders
      if (!buyer) {
        return responseError(res, 403, 'Only registered buyers can create orders.');
      }

      // Construct the payload using the valid buyer.id
      const servicePayload = {
        buyerId: buyer.id,
        storeId: value.storeId,
        type: value.type,
        paymentMethod: value.paymentMethod,
        items: value.items,
      };

      const data = await OrderService.createOrder(servicePayload);
      return responseSuccess(res, 201, data, 'Order created successfully');
    } catch (error) {
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
      next(error);
    }
  }
}
