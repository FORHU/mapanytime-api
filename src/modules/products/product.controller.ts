import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import ProductService from './product.service';
import { responseSuccess, responseError } from '../../helpers/response.helper';
import { parsePagination } from '../../helpers/pagination.helper';
import { money } from '../../helpers/money.helper';
import { ALLOWED_PRODUCT_TAGS } from '../../helpers/product-tags';
import { PRODUCT_LIMITS } from '../../constants/product-limits.constant';

const optionsSchema = Joi.array()
  .max(PRODUCT_LIMITS.OPTIONS_MAX)
  .items(
    Joi.object({
      name: Joi.string().trim().min(1).max(PRODUCT_LIMITS.OPTION_NAME_MAX).required(),
      values: Joi.array()
        .min(1)
        .max(PRODUCT_LIMITS.OPTION_VALUES_MAX)
        .items(Joi.string().trim().min(1).max(PRODUCT_LIMITS.OPTION_VALUE_MAX))
        .required(),
    }),
  )
  .optional();

export default class ProductController {
  static async create(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      storeId: Joi.string().required(),
      name: Joi.string().max(PRODUCT_LIMITS.NAME_MAX).required(),
      price: money().max(PRODUCT_LIMITS.PRICE_MAX).required(),
      brand: Joi.string().allow('', null).max(PRODUCT_LIMITS.BRAND_MAX).optional(),
      description: Joi.string().allow('', null).max(PRODUCT_LIMITS.DESCRIPTION_MAX).optional(),
      categoryId: Joi.string().required(),
      tags: Joi.array()
        .items(Joi.string().valid(...ALLOWED_PRODUCT_TAGS))
        .optional(),
      isActive: Joi.boolean().default(false),
      initialStock: Joi.number().integer().min(0).max(PRODUCT_LIMITS.STOCK_MAX).default(0),
      imageIds: Joi.array().items(Joi.string()).optional(),
      options: optionsSchema,
    });

    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const context = req.orgContext;
      if (!context) return responseError(res, 403, 'Forbidden: No seller organization context');

      const { storeId, ...productData } = value;
      const data = await ProductService.createProduct(context, storeId, productData);

      return responseSuccess(res, 201, data, 'Product created successfully');
    } catch (error) {
      next(error);
    }
  }

  static async index(req: Request, res: Response, next: NextFunction) {
    // Sorting is whitelisted here; page/limit/search pass through parsePagination.
    const schema = Joi.object({
      storeId: Joi.string().optional().allow(null, ''),
      categoryId: Joi.string().optional().allow(null, ''),
      sortBy: Joi.string().valid('price', 'name', 'createdAt').optional(),
      sortOrder: Joi.string().valid('asc', 'desc').optional(),
    }).unknown(true);

    const { error, value } = schema.validate(req.query);
    if (error) return responseError(res, 400, error.message);

    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized');
      const context = req.orgContext;
      if (!context) return responseError(res, 403, 'Forbidden: No seller organization context');

      const { page, limit, skip, search } = parsePagination(req.query as Record<string, unknown>);

      const data = await ProductService.getMyProducts(context, value.storeId, {
        page,
        limit,
        skip,
        search,
        categoryId: value.categoryId || undefined,
        sortBy: value.sortBy,
        sortOrder: value.sortOrder,
      });
      return responseSuccess(res, 200, data);
    } catch (error) {
      next(error);
    }
  }

  static async myCategories(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      storeId: Joi.string().optional().allow(null, ''),
    }).unknown(true);

    const { error, value } = schema.validate(req.query);
    if (error) return responseError(res, 400, error.message);

    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized');
      const context = req.orgContext;
      if (!context) return responseError(res, 403, 'Forbidden: No seller organization context');

      // A seller with no products yet is a valid empty result, not a 404 — the
      // web filter treats a non-2xx as a hard error and would break onboarding.
      const data = await ProductService.getMyCategories(context, value.storeId || undefined);
      return responseSuccess(res, 200, data);
    } catch (error) {
      next(error);
    }
  }

  static async getAllProducts(req: Request, res: Response, next: NextFunction) {
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
      name: Joi.string().max(PRODUCT_LIMITS.NAME_MAX).optional(),
      price: money().max(PRODUCT_LIMITS.PRICE_MAX).optional(),
      // `brand` and `description` are nullable columns, so clearing them is a
      // legitimate edit. Joi rejects '' for a bare string(), which turned every
      // save of a brandless product into a 400. The service maps '' to null.
      brand: Joi.string().allow('', null).max(PRODUCT_LIMITS.BRAND_MAX).optional(),
      description: Joi.string().allow('', null).max(PRODUCT_LIMITS.DESCRIPTION_MAX).optional(),
      categoryId: Joi.string().optional(),
      isActive: Joi.boolean().optional(),
      // Applied in the same transaction as the product fields, so an edit can't
      // half-land the way two sequential requests could.
      stock: Joi.number().integer().min(0).max(PRODUCT_LIMITS.STOCK_MAX).optional(),
      // Replace-all semantics: an array replaces the product's tags wholesale;
      // omitting the key leaves existing tags untouched.
      tags: Joi.array()
        .items(Joi.string().valid(...ALLOWED_PRODUCT_TAGS))
        .optional(),
      // Same replace-all contract as `tags` above.
      options: optionsSchema,
    });

    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const context = req.orgContext;
      if (!context) return responseError(res, 403, 'Forbidden: No seller organization context');

      const actorUserId = (req.user as { id: string })?.id;
      const productId = req.params.id;
      const updatedProduct = await ProductService.updateProduct(
        context,
        actorUserId,
        productId,
        value,
      );

      return responseSuccess(res, 200, updatedProduct, 'Product updated successfully');
    } catch (error) {
      next(error);
    }
  }

  static async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const context = req.orgContext;
      if (!context) return responseError(res, 403, 'Forbidden: No seller organization context');

      const productId = req.params.id;
      await ProductService.deleteProduct(context, productId);

      return responseSuccess(res, 200, null, 'Product archived successfully');
    } catch (error) {
      next(error);
    }
  }
}
