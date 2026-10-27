import { Request, Response, NextFunction } from 'express';
import AdminInviteService from './admin-invite.service';
import { responseSuccess } from '../../helpers/response.helper';
import { INVITESTATUS } from '@prisma/client';

export class AdminInviteController {
  /**
   * POST /v1/admin/invites
   * Creates an administrative invitation and dispatches the invite email.
   */
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const inviterId = req.user?.id;
      if (!inviterId) {
        throw { status: 401, message: 'Authentication required.' };
      }

      const { email, role, expiresInDays } = req.body;
      const invite = await AdminInviteService.createInvite({
        email,
        role,
        inviterId,
        expiresInDays: expiresInDays ? Number(expiresInDays) : undefined,
      });

      return responseSuccess(
        res,
        201,
        invite,
        'Admin invitation created and dispatched successfully.',
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /v1/admin/invites
   * Lists administrative invitations with optional status filter and pagination.
   */
  static async index(req: Request, res: Response, next: NextFunction) {
    try {
      const { status, page, limit } = req.query;
      const result = await AdminInviteService.listInvites({
        status: status as INVITESTATUS | undefined,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      });

      return responseSuccess(res, 200, result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /v1/admin/invites/:id/revoke
   * Revokes a pending administrative invitation.
   */
  static async revoke(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const revoked = await AdminInviteService.revokeInvite(id);
      return responseSuccess(res, 200, revoked, 'Admin invitation revoked successfully.');
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /v1/admin/invites/validate
   * Validates an invitation token for public onboarding form.
   */
  static async validate(req: Request, res: Response, next: NextFunction) {
    try {
      const token = req.query.token as string;
      const result = await AdminInviteService.validateInvite(token);
      return responseSuccess(res, 200, result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /v1/admin/invites/accept
   * Accepts invitation and activates administrator account with credentials.
   */
  static async accept(req: Request, res: Response, next: NextFunction) {
    try {
      const { token, password, firstName, lastName } = req.body;
      const result = await AdminInviteService.acceptInvite({
        token,
        password,
        firstName,
        lastName,
      });

      return responseSuccess(
        res,
        200,
        result,
        'Admin account activated successfully. You can now log in.',
      );
    } catch (error) {
      next(error);
    }
  }
}

export default AdminInviteController;
