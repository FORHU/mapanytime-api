import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import SupplierProductsService from './supplierProducts.service';
import { responseSuccess, responseError } from '../../helpers/response.helper';
import { money } from '../../helpers/money.helper';

export class SupplierProductsController {
  static async create(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      sellerId: Joi.string().required(),
      productId: Joi.string().required(),
      supplierSku: Joi.string().optional(),
      costPrice: money().optional(),
      minimumOrderQty: Joi.number().integer().min(1).default(1),
      supplyLeadDays: Joi.number().integer().min(0).default(1),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const data = await SupplierProductsService.createSupplierProduct(value);
      return responseSuccess(res, 201, data, 'Supplier product record created successfully');
    } catch (error) {
      next(error);
    }
  }

  static async getBySeller(req: Request, res: Response, next: NextFunction) {
    const { sellerId } = req.params;
    try {
      const data = await SupplierProductsService.getSupplierProductsBySeller(sellerId);
      return responseSuccess(res, 200, data);
    } catch (error) {
      next(error);
    }
  }

  static async getByProduct(req: Request, res: Response, next: NextFunction) {
    const { productId } = req.params;
    try {
      const data = await SupplierProductsService.getSupplierProductsByProduct(productId);
      return responseSuccess(res, 200, data);
    } catch (error) {
      next(error);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    const { id } = req.params;
    const schema = Joi.object({
      supplierSku: Joi.string().optional(),
      costPrice: money().optional(),
      minimumOrderQty: Joi.number().integer().min(1).optional(),
      supplyLeadDays: Joi.number().integer().min(0).optional(),
      isAvailable: Joi.boolean().optional(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const data = await SupplierProductsService.updateSupplierProduct(id, value);
      return responseSuccess(res, 200, data, 'Supplier product record updated successfully');
    } catch (error) {
      next(error);
    }
  }

  static async delete(req: Request, res: Response, next: NextFunction) {
    const { id } = req.params;
    try {
      await SupplierProductsService.deleteSupplierProduct(id);
      return responseSuccess(res, 200, null, 'Supplier product record deleted successfully');
    } catch (error) {
      next(error);
    }
  }
}

export default SupplierProductsController;
