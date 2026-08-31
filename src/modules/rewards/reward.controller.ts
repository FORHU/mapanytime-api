import { Request, Response, NextFunction } from 'express';
import { USERVOUCHERSTATUS, REWARDDISCOUNTTYPE } from '@prisma/client';
import RewardService, { DEFAULT_EARN_PERCENTAGE, DEFAULT_POINT_VALUE_PHP } from './reward.service';
import { responseSuccess, responseError } from '../../helpers/response.helper';
import { parsePagination } from '../../helpers/pagination.helper';
import { prisma } from '../../utils/prisma';

async function resolveBuyerId(req: Request): Promise<string> {
  const userId = (req.user as { id: string })?.id;
  const buyer = await prisma.buyers.findUnique({ where: { userId } });
  if (!buyer) throw { status: 403, message: 'No buyer profile for this account.' };
  return buyer.id;
}

export default class RewardController {
  static async getWallet(req: Request, res: Response, next: NextFunction) {
    try {
      const buyerId = await resolveBuyerId(req);
      const wallet = await RewardService.getWallet(buyerId);
      return responseSuccess(res, 200, wallet, 'MapPoints wallet fetched successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async getTransactions(req: Request, res: Response, next: NextFunction) {
    try {
      const buyerId = await resolveBuyerId(req);
      const params = parsePagination(req.query as Record<string, unknown>);
      const page = await RewardService.getTransactions(buyerId, params);
      return responseSuccess(res, 200, page, 'MapPoints transactions fetched successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async listVoucherCatalog(_req: Request, res: Response, next: NextFunction) {
    try {
      const vouchers = await RewardService.listVoucherCatalog();
      return responseSuccess(res, 200, vouchers, 'Voucher catalog fetched successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async claimVoucher(req: Request, res: Response, next: NextFunction) {
    try {
      const buyerId = await resolveBuyerId(req);
      const { id } = req.params;
      const claimed = await RewardService.claimVoucher(buyerId, id);
      return responseSuccess(res, 201, claimed, 'Voucher claimed successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async getMyVouchers(req: Request, res: Response, next: NextFunction) {
    try {
      const buyerId = await resolveBuyerId(req);
      const status = req.query.status as USERVOUCHERSTATUS | undefined;
      if (status && !Object.values(USERVOUCHERSTATUS).includes(status)) {
        return responseError(
          res,
          400,
          `Invalid status. Must be one of: ${Object.values(USERVOUCHERSTATUS).join(', ')}`,
        );
      }
      const vouchers = await RewardService.getMyVouchers(buyerId, status);
      return responseSuccess(res, 200, vouchers, 'Claimed vouchers fetched successfully.');
    } catch (error) {
      next(error);
    }
  }

  /** Display-safe subset of the active config, for buyer-facing earn estimates. */
  static async getPublicConfig(_req: Request, res: Response, next: NextFunction) {
    try {
      const config = await RewardService.getActiveConfig();
      return responseSuccess(
        res,
        200,
        {
          earnPercentage: config?.earnPercentage ?? DEFAULT_EARN_PERCENTAGE,
          pointValueInPhp: config?.pointValueInPhp ?? DEFAULT_POINT_VALUE_PHP,
          isEarningActive: config?.isEarningActive ?? true,
        },
        'MapPoints configuration fetched successfully.',
      );
    } catch (error) {
      next(error);
    }
  }

  static async getConfig(_req: Request, res: Response, next: NextFunction) {
    try {
      const config = await RewardService.getActiveConfig();
      return responseSuccess(res, 200, config, 'MapPoints configuration fetched successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async updateConfig(req: Request, res: Response, next: NextFunction) {
    try {
      const adminUserId = (req.user as { id: string })?.id;
      const updated = await RewardService.updateConfig(adminUserId, req.body);
      return responseSuccess(res, 200, updated, 'MapPoints configuration updated successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async listVouchersAdmin(_req: Request, res: Response, next: NextFunction) {
    try {
      const vouchers = await RewardService.listVouchersAdmin();
      return responseSuccess(res, 200, vouchers, 'Vouchers fetched successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async createVoucher(req: Request, res: Response, next: NextFunction) {
    try {
      const { discountType, ...rest } = req.body;
      if (!Object.values(REWARDDISCOUNTTYPE).includes(discountType)) {
        return responseError(
          res,
          400,
          `Invalid discountType. Must be one of: ${Object.values(REWARDDISCOUNTTYPE).join(', ')}`,
        );
      }
      const voucher = await RewardService.createVoucher({ ...rest, discountType });
      return responseSuccess(res, 201, voucher, 'Voucher created successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async updateVoucher(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const voucher = await RewardService.updateVoucher(id, req.body);
      return responseSuccess(res, 200, voucher, 'Voucher updated successfully.');
    } catch (error) {
      next(error);
    }
  }
}
