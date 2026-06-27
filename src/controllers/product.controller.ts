import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import ProductService from '../services/product.service';
import { responseSuccess, responseError } from '../helpers/response.helper';

export default class ProductController {
  static async create(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      name: Joi.string().required(),
      price: Joi.number().min(0).required(),
      brand: Joi.string().optional(),
      description: Joi.string().optional(),
      category: Joi.string().optional(),
      isActive: Joi.boolean().default(false),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized');

      const data = await ProductService.createProduct(userId, value);
      return responseSuccess(res, 201, data, 'Product created successfully');
    } catch (error) {
      next(error);
    }
  }

  static async index(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized');

      const data = await ProductService.getMyProducts(userId);
      return responseSuccess(res, 200, data);
    } catch (error) {
      next(error);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      name: Joi.string().optional(),
      price: Joi.number().min(0).optional(),
      brand: Joi.string().optional(),
      description: Joi.string().optional(),
      category: Joi.string().optional(),
      isActive: Joi.boolean().optional(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized');

      const productId = req.params.id;
      const updatedProduct = await ProductService.updateProduct(userId, productId, value);

      return responseSuccess(res, 200, updatedProduct, 'Product updated successfully');
    } catch (error) {
      next(error);
    }
  }

  static async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized');

      const productId = req.params.id;
      await ProductService.deleteProduct(userId, productId);

      return responseSuccess(res, 200, null, 'Product deleted successfully');
    } catch (error) {
      next(error);
    }
  }
}
