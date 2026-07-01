import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import CategoryService from '../services/category.service';
import { responseSuccess, responseError } from '../helpers/response.helper';

export default class CategoryController {
  static async create(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      name: Joi.string().required(),
      description: Joi.string().optional(),
      parentId: Joi.string().optional(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const servicePayload = {
        name: value.name,
        description: value.description,
        parentId: value.parentId,
      };

      const data = await CategoryService.createCategory(servicePayload);
      return responseSuccess(res, 201, data, 'Category created successfully');
    } catch (error) {
      next(error);
    }
  }

  static async index(req: Request, res: Response, next: NextFunction) {
    try {
      const servicePayload = {
        parentId: req.query.parentId as string | undefined,
      };

      const data = await CategoryService.listCategories(servicePayload);
      return responseSuccess(res, 200, data);
    } catch (error) {
      next(error);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    const { id } = req.params;
    const schema = Joi.object({
      name: Joi.string().optional(),
      description: Joi.string().optional(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const servicePayload = {
        categoryId: id,
        updateData: value,
      };

      const data = await CategoryService.updateCategory(servicePayload);
      return responseSuccess(res, 200, data, 'Category updated successfully');
    } catch (error) {
      next(error);
    }
  }

  static async destroy(req: Request, res: Response, next: NextFunction) {
    const { id } = req.params;

    try {
      const servicePayload = {
        categoryId: id,
      };

      const result = await CategoryService.deleteCategory(servicePayload);
      return responseSuccess(res, 200, null, result.message);
    } catch (error) {
      next(error);
    }
  }
}
