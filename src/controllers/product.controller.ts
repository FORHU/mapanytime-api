import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import ProductService from '../services/product.service';
import { responseSuccess, responseError } from '../helpers/response.helper';

export default class ProductController {
  static async create(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      Name: Joi.string().required(),
      Price: Joi.number().min(0).required(),
      Brand: Joi.string().optional(),
      Description: Joi.string().optional(),
      Category: Joi.string().optional(),
      IsActive: Joi.boolean().default(false),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      // Using PascalCase property
      const userId = req.user?.Id;
      if (!userId) return responseError(res, 401, 'Unauthorized');

      const data = await ProductService.createProduct(userId, value);
      return responseSuccess(res, 201, data, 'Product created successfully');
    } catch (error) {
      next(error);
    }
  }

  static async index(req: Request, res: Response, next: NextFunction) {
    try {
      // Using PascalCase property
      const userId = req.user?.Id;
      if (!userId) return responseError(res, 401, 'Unauthorized');

      const data = await ProductService.getMyProducts(userId);
      return responseSuccess(res, 200, data);
    } catch (error) {
      next(error);
    }
  }
}
