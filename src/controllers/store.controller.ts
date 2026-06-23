import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import StoreService from '../services/store.service';
import { responseSuccess, responseError } from '../helpers/response.helper';

export default class StoreController {
  static async getNearby(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      lat: Joi.number().required(),
      lng: Joi.number().required(),
      radius: Joi.number().default(10), // Default 10km radius
    });

    const { error, value } = schema.validate(req.query);
    if (error) return responseError(res, 400, error.message);

    try {
      const data = await StoreService.getNearbyStores(value.lat, value.lng, value.radius);
      return responseSuccess(res, 200, data);
    } catch (error) {
      next(error);
    }
  }
}