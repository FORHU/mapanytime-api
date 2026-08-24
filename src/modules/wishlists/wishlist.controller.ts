import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import WishlistService from './wishlist.service';
import { responseSuccess, responseError } from '../../helpers/response.helper';

export default class WishlistController {
  static async index(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized access.');

      const data = await WishlistService.getWishlist(userId);
      return responseSuccess(res, 200, data, 'Wishlist fetched successfully');
    } catch (error) {
      next(error);
    }
  }

  static async add(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      productId: Joi.string().required(),
      variantId: Joi.string().optional(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized access.');

      const data = await WishlistService.addItem(userId, value.productId, value.variantId);
      return responseSuccess(res, 201, data, 'Saved to your wishlist');
    } catch (error) {
      next(error);
    }
  }

  static async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized access.');

      const variantId = typeof req.query.variantId === 'string' ? req.query.variantId : undefined;
      const data = await WishlistService.removeItem(userId, req.params.productId, variantId);
      return responseSuccess(res, 200, data, 'Removed from your wishlist');
    } catch (error) {
      next(error);
    }
  }

  /** Which of the given products are saved — one call for a whole grid. */
  static async saved(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized access.');

      const raw = req.query.productIds;
      const productIds =
        typeof raw === 'string'
          ? raw
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : [];

      const data = await WishlistService.getSavedProductIds(userId, productIds);
      return responseSuccess(res, 200, data, 'Saved product ids fetched successfully');
    } catch (error) {
      next(error);
    }
  }

  static async clear(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized access.');

      const data = await WishlistService.clear(userId);
      return responseSuccess(res, 200, data, 'Wishlist cleared');
    } catch (error) {
      next(error);
    }
  }
}
