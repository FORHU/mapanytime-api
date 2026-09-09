import { NextFunction, Request, Response } from 'express';
import Joi from 'joi';
import { responseError, responseSuccess } from '../../helpers/response.helper';
import AdminApprovalService from './adminApproval.service';

const rejectionSchema = Joi.object({
  reason: Joi.string().trim().min(3).max(1000).required(),
});

// Same constraints as a rejection reason: both are the only thing the seller
// gets told, so neither is worth accepting as three characters of nothing.
const revisionSchema = Joi.object({
  notes: Joi.string().trim().min(3).max(1000).required(),
});

const claimSchema = Joi.object({
  // Set when the admin has seen who holds the claim and chosen to take it
  // anyway. Absent means "only claim if it is free".
  force: Joi.boolean().default(false),
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

  /**
   * Take the store for review. Refuses with ALREADY_CLAIMED and the holder's
   * name when someone else has it, unless `force` says the admin has seen that
   * and decided to take over anyway.
   */
  static async claimStore(req: Request, res: Response, next: NextFunction) {
    try {
      const adminId = getAdminId(req);
      if (!adminId) return responseError(res, 401, 'Unauthorized.');

      const { error, value } = claimSchema.validate(req.body ?? {});
      if (error) return responseError(res, 400, error.message);

      const store = await AdminApprovalService.claimStore(req.params.id, adminId, value.force);
      return responseSuccess(res, 200, store, 'Store claimed for review.');
    } catch (error) {
      AdminApprovalController.handleError(error, res, next);
    }
  }

  static async releaseStore(req: Request, res: Response, next: NextFunction) {
    try {
      const adminId = getAdminId(req);
      if (!adminId) return responseError(res, 401, 'Unauthorized.');

      const store = await AdminApprovalService.releaseStore(req.params.id, adminId);
      return responseSuccess(res, 200, store, 'Review claim released.');
    } catch (error) {
      AdminApprovalController.handleError(error, res, next);
    }
  }

  /** Send the store back to the seller with a list of what to fix. */
  static async requestStoreRevision(req: Request, res: Response, next: NextFunction) {
    try {
      const adminId = getAdminId(req);
      if (!adminId) return responseError(res, 401, 'Unauthorized.');

      const { error, value } = revisionSchema.validate(req.body);
      if (error) return responseError(res, 400, error.message);

      const store = await AdminApprovalService.requestStoreRevision(
        req.params.id,
        adminId,
        value.notes,
      );
      return responseSuccess(res, 200, store, 'Revision requested.');
    } catch (error) {
      AdminApprovalController.handleError(error, res, next);
    }
  }

  static async storeHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const history = await AdminApprovalService.getStoreHistory(req.params.id);
      return responseSuccess(res, 200, history);
    } catch (error) {
      AdminApprovalController.handleError(error, res, next);
    }
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

  /**
   * Thrown errors from the approval services carry a `code` (and sometimes
   * `details`, such as who is holding a claim) that the admin UI branches on,
   * so both are forwarded rather than flattened into a bare message.
   */
  private static handleError(error: unknown, res: Response, next: NextFunction) {
    const err = error as {
      status?: Parameters<typeof responseError>[1];
      message?: string;
      code?: string;
      details?: unknown;
    };
    if (err.status) {
      return responseError(res, err.status, err.message || 'Request could not be completed.', {
        ...(err.code ? { code: err.code } : {}),
        ...(err.details ? { details: err.details } : {}),
      });
    }
    next(error);
  }
}
