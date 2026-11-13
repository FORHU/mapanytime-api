import { Request, Response, NextFunction } from 'express';
import AuditService from './audit.service';
import { responseSuccess, responseError } from '../../helpers/response.helper';

export default class AuditController {
  /**
   * GET /v1/admin/audit-logs
   * Search and filter audit log entries (Admin only).
   */
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { performedById, action, entityType, entityId, from, to, page, limit } = req.query;

      let fromDate: Date | undefined;
      let toDate: Date | undefined;

      if (from) {
        fromDate = new Date(from as string);
        if (isNaN(fromDate.getTime())) {
          return responseError(res, 400, 'Invalid "from" date parameter.');
        }
      }

      if (to) {
        toDate = new Date(to as string);
        if (isNaN(toDate.getTime())) {
          return responseError(res, 400, 'Invalid "to" date parameter.');
        }
      }

      const parsedPage = page ? parseInt(page as string, 10) : 1;
      const parsedLimit = limit ? parseInt(limit as string, 10) : 20;

      if (isNaN(parsedPage) || parsedPage < 1) {
        return responseError(res, 400, 'Page must be a positive integer.');
      }
      if (isNaN(parsedLimit) || parsedLimit < 1) {
        return responseError(res, 400, 'Limit must be a positive integer.');
      }

      const result = await AuditService.list({
        performedById: performedById ? (performedById as string) : undefined,
        action: action ? (action as string) : undefined,
        entityType: entityType ? (entityType as string) : undefined,
        entityId: entityId ? (entityId as string) : undefined,
        from: fromDate,
        to: toDate,
        page: parsedPage,
        limit: Math.min(100, parsedLimit),
      });

      return responseSuccess(res, 200, result);
    } catch (error) {
      next(error);
    }
  }
}
