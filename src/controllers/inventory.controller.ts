import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import InventoryService from '../services/inventory.service';
import { responseSuccess, responseError } from '../helpers/response.helper';

export default class InventoryController {
  static async restock(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      addedQuantity: Joi.number().integer().min(1).required(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const userId = (req.user as { id: string })?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized access.');

      const productId = req.params.productId;

      const data = await InventoryService.restock(userId, productId, value.addedQuantity);
      return responseSuccess(res, 200, data, 'Stock replenished successfully');
    } catch (error) {
      const err = error as { status?: Parameters<typeof responseError>[1]; message?: string };

      if (err.status) {
        return responseError(res, err.status, err.message || 'An error occurred');
      }
      next(error);
    }
  }

  static async getInventory(req: Request, res: Response, next: NextFunction) {
    try {
      const { productId } = req.params;
      if (!productId) return responseError(res, 400, 'Product ID is required.');

      const data = await InventoryService.getInventory(productId);
      return responseSuccess(res, 200, data, 'Inventory fetched successfully.');
    } catch (error) {
      const err = error as { status?: Parameters<typeof responseError>[1]; message?: string };
      if (err.status) {
        return responseError(res, err.status, err.message || 'An error occurred');
      }
      next(error);
    }
  }
}
