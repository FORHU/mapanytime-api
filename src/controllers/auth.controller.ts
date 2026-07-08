import { Request, Response, NextFunction } from 'express';
import { Users } from '@prisma/client';
import Joi from 'joi';
import AuthSvc from '../services/auth.service';
import { responseSuccess, responseError } from '../helpers/response.helper';
import logger from '../utils/logger';

export default class AuthController {
  // Register a new user
  static async register(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      email: Joi.string().email().required(),
      password: Joi.string().min(6).required(),
      firstName: Joi.string().optional(),
      lastName: Joi.string().optional(),
      roleName: Joi.string().required(),
      countryCode: Joi.string().max(3).optional(),

      sellerDocuments: Joi.object({
        tinIdFileName: Joi.string().required(),
        tinIdKey: Joi.string().required(),
        govIdFileName: Joi.string().required(),
        govIdKey: Joi.string().required(),
      }).when('roleName', {
        is: 'SELLER',
        then: Joi.required(),
        otherwise: Joi.forbidden(),
      }),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      await AuthSvc.register(value);
      return responseSuccess(res, 201, null, 'Registration successful');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Login with email/password
   */
  static async login(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      email: Joi.string().email().required(),
      password: Joi.string().required(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const data = await AuthSvc.login(value);
      return responseSuccess(res, 200, data, 'Login successful');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Refresh access token
   */
  static async refreshToken(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      refreshToken: Joi.string().required(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const data = await AuthSvc.refreshToken(value.refreshToken);
      return responseSuccess(res, 200, data, 'Token refreshed successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Logout
   */
  static async logout(req: Request, res: Response, next: NextFunction) {
    try {
      const { refreshToken } = req.body;
      const user = req.user as Users;
      const userId = user?.id;

      logger.info(
        `[Auth] Logout request received (user: ${userId ?? 'none'}, hasRefreshToken: ${Boolean(
          refreshToken,
        )})`,
      );

      if (!userId) {
        logger.warn('[Auth] Logout rejected — no authenticated user');
        return responseError(res, 401, 'Unauthorized');
      }

      const result = await AuthSvc.logout(userId, refreshToken);

      return responseSuccess(res, 200, {}, result.message);
    } catch (error) {
      next(error);
    }
  }
}
