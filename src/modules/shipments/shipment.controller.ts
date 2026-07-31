import { Request, Response, NextFunction } from 'express';
import ShipmentService from './shipment.service';
import { responseSuccess } from '../../helpers/response.helper';

export default class ShipmentController {
  static async createShipment(req: Request, res: Response, next: NextFunction) {
    try {
      const shipment = await ShipmentService.createShipment(req.body);
      return responseSuccess(res, 201, shipment, 'Shipment created successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async getShipmentByOrderId(req: Request, res: Response, next: NextFunction) {
    try {
      const { orderId } = req.params;
      const shipment = await ShipmentService.getShipmentByOrderId(orderId);
      return responseSuccess(res, 200, shipment, 'Shipment fetched successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async updateShipmentStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const shipment = await ShipmentService.updateShipmentStatus(id, req.body);
      return responseSuccess(res, 200, shipment, 'Shipment status updated successfully.');
    } catch (error) {
      next(error);
    }
  }
}
