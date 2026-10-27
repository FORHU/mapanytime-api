import { Request, Response, NextFunction } from 'express';
import AgentCommissionService from './agent-commission.service';
import { requestPayoutSchema, updateCommissionConfigSchema } from './agent-commission.schema';
import { responseSuccess, responseError } from '../../helpers/response.helper';
import { COMMISSIONSTATUS } from '@prisma/client';

export default class AgentCommissionController {
  static async getAccountSummary(req: Request, res: Response, next: NextFunction) {
    try {
      const agentId = (req.user as { id?: string })?.id;
      if (!agentId) return responseError(res, 401, 'Unauthorized');

      const data = await AgentCommissionService.getAccountSummary(agentId);
      return responseSuccess(res, 200, data, 'Agent commission account summary retrieved');
    } catch (error) {
      next(error);
    }
  }

  static async getTransactions(req: Request, res: Response, next: NextFunction) {
    try {
      const agentId = (req.user as { id?: string })?.id;
      if (!agentId) return responseError(res, 401, 'Unauthorized');

      const page = req.query.page ? Number(req.query.page) : 1;
      const limit = req.query.limit ? Number(req.query.limit) : 20;
      const status = req.query.status as COMMISSIONSTATUS | undefined;

      const data = await AgentCommissionService.getTransactions(agentId, {
        page,
        limit,
        status,
      });
      return responseSuccess(res, 200, data, 'Agent commission transactions retrieved');
    } catch (error) {
      next(error);
    }
  }

  static async getPayouts(req: Request, res: Response, next: NextFunction) {
    try {
      const agentId = (req.user as { id?: string })?.id;
      if (!agentId) return responseError(res, 401, 'Unauthorized');

      const page = req.query.page ? Number(req.query.page) : 1;
      const limit = req.query.limit ? Number(req.query.limit) : 20;

      const data = await AgentCommissionService.getPayouts(agentId, { page, limit });
      return responseSuccess(res, 200, data, 'Agent payouts retrieved');
    } catch (error) {
      next(error);
    }
  }

  static async requestPayout(req: Request, res: Response, next: NextFunction) {
    const { error, value } = requestPayoutSchema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const agentId = (req.user as { id?: string })?.id;
      if (!agentId) return responseError(res, 401, 'Unauthorized');

      const data = await AgentCommissionService.requestPayout(
        agentId,
        value.amount,
        value.paymentMethod,
        value.reference,
      );
      return responseSuccess(res, 201, data, 'Payout requested successfully');
    } catch (error) {
      next(error);
    }
  }

  static async getConfig(_req: Request, res: Response, next: NextFunction) {
    try {
      const data = await AgentCommissionService.getActiveConfig();
      return responseSuccess(res, 200, data, 'Commission configuration retrieved');
    } catch (error) {
      next(error);
    }
  }

  static async updateConfig(req: Request, res: Response, next: NextFunction) {
    const { error, value } = updateCommissionConfigSchema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const adminUserId = (req.user as { id?: string })?.id || '';
      const data = await AgentCommissionService.updateConfig(adminUserId, value);
      return responseSuccess(res, 200, data, 'Commission configuration updated');
    } catch (error) {
      next(error);
    }
  }

  static async approvePayout(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { reference } = req.body;
      const data = await AgentCommissionService.approvePayout(id, reference);
      return responseSuccess(res, 200, data, 'Payout approved successfully');
    } catch (error) {
      next(error);
    }
  }
}
