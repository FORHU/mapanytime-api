import { NextFunction, Request, Response } from 'express';
import Joi from 'joi';
import { responseError, responseSuccess } from '../../helpers/response.helper';
import AdminApprovalService from './adminApproval.service';

const rejectionSchema = Joi.object({
  reason: Joi.string().trim().min(3).max(1000).required(),
});

const getAdminId = (req: Request) => (req.user as { id?: string } | undefined)?.id;

export default class AdminApprovalController {
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const approvals = await AdminApprovalService.listApprovals();
      return responseSuccess(res, 200, approvals);
    } catch (error) {
      next(error);
    }
  }

  static async approveProperty(req: Request, res: Response, next: NextFunction) {
    try {
      const adminId = getAdminId(req);
      if (!adminId) return responseError(res, 401, 'Unauthorized.');
      const property = await AdminApprovalService.approveProperty(req.params.id, adminId);
      return responseSuccess(res, 200, property, 'Property approved successfully.');
    } catch (error) {
      AdminApprovalController.handleError(error, res, next);
    }
  }

  static async rejectProperty(req: Request, res: Response, next: NextFunction) {
    return AdminApprovalController.reject(req, res, next, 'property');
  }

  static async approveStore(req: Request, res: Response, next: NextFunction) {
    try {
      const adminId = getAdminId(req);
      if (!adminId) return responseError(res, 401, 'Unauthorized.');
      const store = await AdminApprovalService.approveStore(req.params.id, adminId);
      return responseSuccess(res, 200, store, 'Store approved successfully.');
    } catch (error) {
      AdminApprovalController.handleError(error, res, next);
    }
  }

  static async rejectStore(req: Request, res: Response, next: NextFunction) {
    return AdminApprovalController.reject(req, res, next, 'store');
  }

  private static async reject(
    req: Request,
    res: Response,
    next: NextFunction,
    entity: 'property' | 'store',
  ) {
    try {
      const adminId = getAdminId(req);
      if (!adminId) return responseError(res, 401, 'Unauthorized.');

      const { error, value } = rejectionSchema.validate(req.body);
      if (error) return responseError(res, 400, error.message);

      const result =
        entity === 'property'
          ? await AdminApprovalService.rejectProperty(req.params.id, adminId, value.reason)
          : await AdminApprovalService.rejectStore(req.params.id, adminId, value.reason);

      return responseSuccess(res, 200, result, `${entity} rejected successfully.`);
    } catch (error) {
      AdminApprovalController.handleError(error, res, next);
    }
  }

  private static handleError(error: unknown, res: Response, next: NextFunction) {
    const err = error as { status?: 404; message?: string };
    if (err.status) return responseError(res, err.status, err.message || 'Resource not found.');
    next(error);
  }
}
