import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import CartService from '../services/cart.service';
import { responseSuccess, responseError } from '../helpers/response.helper';

export default class CartController {
  static async getCart(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized access.');

      const cart = await CartService.getCart(userId);
      return responseSuccess(res, 200, cart, 'Cart retrieved successfully');
    } catch (error) {
      const err = error as { status?: Parameters<typeof responseError>[1]; message?: string };

      if (err.status) {
        return responseError(res, err.status, err.message || 'An error occurred');
      }
      next(error);
    }
  }

  static async addToCart(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      storeId: Joi.string().required(),
      productId: Joi.string().required(),
      quantity: Joi.number().integer().min(0).required(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized access.');

      const cart = await CartService.addToCart(
        userId,
        value.storeId,
        value.productId,
        value.quantity,
      );

      return responseSuccess(res, 200, cart, 'Item added to cart successfully');
    } catch (error) {
      const err = error as { status?: Parameters<typeof responseError>[1]; message?: string };

      if (err.status) {
        return responseError(res, err.status, err.message || 'An error occurred');
      }
      next(error);
    }
  }

  static async clearCart(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized access.');

      const result = await CartService.clearCart(userId);
      return responseSuccess(res, 200, result, 'Cart cleared successfully');
    } catch (error) {
      const err = error as { status?: Parameters<typeof responseError>[1]; message?: string };

      if (err.status) {
        return responseError(res, err.status, err.message || 'An error occurred');
      }
      next(error);
    }
  }
}
