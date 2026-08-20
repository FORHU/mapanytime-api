import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import ReviewService from './review.service';
import { responseSuccess, responseError } from '../../helpers/response.helper';
import { parsePagination } from '../../helpers/pagination.helper';

const reviewBodySchema = Joi.object({
  rating: Joi.number().integer().min(1).max(5).required(),
  comment: Joi.string().trim().allow('').max(2000).optional(),
});

export default class ReviewController {
  static async listProductReviews(req: Request, res: Response, next: NextFunction) {
    try {
      const { limit, skip } = parsePagination(req.query as Record<string, unknown>);
      const data = await ReviewService.getProductReviews(req.params.productId, {
        skip,
        take: limit,
      });
      return responseSuccess(res, 200, data, 'Product reviews fetched successfully');
    } catch (error) {
      next(error);
    }
  }

  static async upsertProductReview(req: Request, res: Response, next: NextFunction) {
    const { error, value } = reviewBodySchema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized access.');

      const data = await ReviewService.upsertProductReview({
        userId,
        productId: req.params.productId,
        rating: value.rating,
        comment: value.comment || undefined,
      });
      return responseSuccess(res, 200, data, 'Review saved successfully');
    } catch (error) {
      next(error);
    }
  }

  static async deleteProductReview(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized access.');

      const data = await ReviewService.deleteProductReview(userId, req.params.reviewId);
      return responseSuccess(res, 200, data, data.message);
    } catch (error) {
      next(error);
    }
  }

  static async listStoreReviews(req: Request, res: Response, next: NextFunction) {
    try {
      const { limit, skip } = parsePagination(req.query as Record<string, unknown>);
      const data = await ReviewService.getStoreReviews(req.params.storeId, { skip, take: limit });
      return responseSuccess(res, 200, data, 'Store reviews fetched successfully');
    } catch (error) {
      next(error);
    }
  }

  static async upsertStoreReview(req: Request, res: Response, next: NextFunction) {
    const { error, value } = reviewBodySchema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized access.');

      const data = await ReviewService.upsertStoreReview({
        userId,
        storeId: req.params.storeId,
        rating: value.rating,
        comment: value.comment || undefined,
      });
      return responseSuccess(res, 200, data, 'Review saved successfully');
    } catch (error) {
      next(error);
    }
  }

  static async deleteStoreReview(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized access.');

      const data = await ReviewService.deleteStoreReview(userId, req.params.reviewId);
      return responseSuccess(res, 200, data, data.message);
    } catch (error) {
      next(error);
    }
  }

  static async myReviews(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized access.');

      const data = await ReviewService.getMyReviews(userId);
      return responseSuccess(res, 200, data, 'Your reviews fetched successfully');
    } catch (error) {
      next(error);
    }
  }
}
