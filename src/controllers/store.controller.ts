import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import StoreService from '../services/store.service';
import { responseSuccess, responseError } from '../helpers/response.helper';

export default class StoreController {
  static async getNearby(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      north: Joi.number().required(),
      south: Joi.number().required(),
      east: Joi.number().required(),
      west: Joi.number().required(),
      limit: Joi.number().integer().min(1).max(500).default(100), // Default 100 limit, max 500
    });

    const { error, value } = schema.validate(req.query);
    if (error) return responseError(res, 400, error.message);

    try {
      const data = await StoreService.getNearbyStores(
        value.north,
        value.south,
        value.east,
        value.west,
        value.limit,
      );
      return responseSuccess(res, 200, data);
    } catch (error) {
      next(error);
    }
  }
}
