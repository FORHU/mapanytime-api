import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import ProductService from '../services/product.service';
import { responseSuccess, responseError } from '../helpers/response.helper';
import { parsePagination } from '../helpers/pagination.helper';

export default class ProductController {
  static async create(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      storeId: Joi.string().required(),
      name: Joi.string().required(),
      price: Joi.number().min(0).required(),
      brand: Joi.string().optional(),
      description: Joi.string().optional(),
      categoryId: Joi.string().required(),
      tags: Joi.array().items(Joi.string()).optional(),
      isActive: Joi.boolean().default(false),
      initialStock: Joi.number().integer().min(0).default(0),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized');

      const { storeId, ...productData } = value;
      const data = await ProductService.createProduct(userId, storeId, productData);

      return responseSuccess(res, 201, data, 'Product created successfully');
    } catch (error) {
      next(error);
    }
  }

  static async index(req: Request, res: Response, next: NextFunction) {
    // For listing products, the frontend should pass the specific storeId via query params
    const storeId = req.query.storeId as string;

    if (!storeId) {
      return responseError(res, 400, 'storeId query parameter is required');
    }

    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized');

      const data = await ProductService.getMyProducts(userId, storeId);
      return responseSuccess(res, 200, data);
    } catch (error) {
      next(error);
    }
  }

  static async getAllProducts(req: Request, res: Response, next: NextFunction) {
    // Buyer-facing catalog: all active products across stores, with optional
    // store, category, and price-range filters. Authenticated but not
    // ownership-scoped (any logged-in user may browse).
    const schema = Joi.object({
      storeId: Joi.string().optional(),
      categoryId: Joi.string().optional(),
      search: Joi.string().trim().allow('').optional(),
      minPrice: Joi.number().min(0).optional(),
      maxPrice: Joi.number()
        .min(0)
        .optional()
        .when('minPrice', {
          is: Joi.exist(),
          then: Joi.number().min(Joi.ref('minPrice')),
        }),
      // Pagination params are parsed separately by parsePagination.
    }).unknown(true);

    const { error, value } = schema.validate(req.query);
    if (error) return responseError(res, 400, error.message);

    try {
      const { page, limit, skip } = parsePagination(req.query as Record<string, unknown>);
      const data = await ProductService.getAllProducts({
        storeId: value.storeId,
        categoryId: value.categoryId,
        search: value.search,
        minPrice: value.minPrice,
        maxPrice: value.maxPrice,
        page,
        limit,
        skip,
      });
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
      categoryId: Joi.string().optional(),
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

      return responseSuccess(res, 200, null, 'Product archived successfully');
    } catch (error) {
      next(error);
    }
  }
}
