import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import CategoryService from '../services/category.service';
import { responseSuccess, responseError } from '../helpers/response.helper';

export default class CategoryController {
  static async create(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      name: Joi.string().required(),
      description: Joi.string().optional(),
      storeId: Joi.string().required(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized');

      const data = await CategoryService.createCategory(userId, value.storeId, {
        name: value.name,
        description: value.description,
      });

      return responseSuccess(res, 201, data, 'Category created successfully');
    } catch (error) {
      next(error);
    }
  }

  static async index(req: Request, res: Response, next: NextFunction) {
    const storeId = req.query.storeId as string;

    if (!storeId) {
      return responseError(res, 400, 'storeId query parameter is required');
    }

    try {
      const data = await CategoryService.listCategories(storeId);
      return responseSuccess(res, 200, data);
    } catch (error) {
      next(error);
    }
  }
}
