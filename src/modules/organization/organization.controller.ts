import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import OrganizationService from './organization.service';
import { responseSuccess, responseError } from '../../helpers/response.helper';
import type { OrgContext } from './orgContext';

function requireContext(req: Request): OrgContext & { organizationId: string } {
  const ctx = req.orgContext;
  if (!ctx?.organizationId) throw { status: 403, message: 'Not a member of a seller organization' };
  return ctx as OrgContext & { organizationId: string };
}

export default class OrganizationController {
  /** GET /v1/seller/org/context — the "Selected Store" dropdown payload. */
  static getContext(req: Request, res: Response, next: NextFunction) {
    try {
      const ctx = requireContext(req);
      const data = OrganizationService.getContext(ctx, ctx.organizationId);
      return responseSuccess(res, 200, data);
    } catch (error) {
      next(error);
    }
  }

  /** GET /v1/seller/org/stores — stores the caller can access. */
  static async getStores(req: Request, res: Response, next: NextFunction) {
    try {
      const ctx = requireContext(req);
      const stores = await OrganizationService.getStores(ctx);
      return responseSuccess(res, 200, stores);
    } catch (error) {
      next(error);
    }
  }

  // --- Members -------------------------------------------------------------

  static async listMembers(req: Request, res: Response, next: NextFunction) {
    try {
      const ctx = requireContext(req);
      const data = await OrganizationService.listMembers(ctx.organizationId);
      return responseSuccess(res, 200, data);
    } catch (error) {
      next(error);
    }
  }

  static async createMember(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      userId: Joi.string().required(),
      role: Joi.string().valid('SELLER_ADMIN', 'MANAGER', 'SELLER_USER').required(),
      storeIds: Joi.array().items(Joi.string()).default([]),
      // Omitted entirely means "use the role default"; an explicit [] means
      // "no features" and is honoured as such.
      permissions: Joi.array().items(Joi.string()).optional(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const ctx = requireContext(req);
      const member = await OrganizationService.createMember(
        ctx.organizationId,
        value.userId,
        value.role,
        value.storeIds,
        value.permissions,
      );
      return responseSuccess(res, 201, member, 'Member added successfully');
    } catch (error) {
      next(error);
    }
  }

  /** POST /v1/seller/org/members/create — new account + membership + stores. */
  static async createStaffAccount(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      firstName: Joi.string().trim().min(1).required(),
      lastName: Joi.string().trim().min(1).required(),
      email: Joi.string().email().required(),
      role: Joi.string().valid('SELLER_ADMIN', 'MANAGER', 'SELLER_USER').default('SELLER_USER'),
      storeIds: Joi.array().items(Joi.string()).default([]),
      permissions: Joi.array().items(Joi.string()).optional(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const ctx = requireContext(req);
      const data = await OrganizationService.createStaffAccount(ctx.organizationId, value);
      return responseSuccess(res, 201, data, 'Staff account created');
    } catch (error) {
      next(error);
    }
  }

  static async updateMember(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      role: Joi.string().valid('SELLER_ADMIN', 'MANAGER', 'SELLER_USER').optional(),
      storeIds: Joi.array().items(Joi.string()).optional(),
      permissions: Joi.array().items(Joi.string()).optional(),
    });
    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const ctx = requireContext(req);
      const member = await OrganizationService.updateMember(
        ctx.organizationId,
        req.params.id,
        value.role,
        value.storeIds,
        value.permissions,
      );
      return responseSuccess(res, 200, member, 'Member updated successfully');
    } catch (error) {
      next(error);
    }
  }

  static async deleteMember(req: Request, res: Response, next: NextFunction) {
    try {
      const ctx = requireContext(req);
      const actorId = (req.user as { id?: string })?.id ?? '';
      const data = await OrganizationService.deleteMember(
        ctx.organizationId,
        req.params.id,
        actorId,
      );
      return responseSuccess(res, 200, data, 'Member removed successfully');
    } catch (error) {
      next(error);
    }
  }
}
