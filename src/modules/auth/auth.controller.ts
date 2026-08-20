import { Request, Response, NextFunction } from 'express';
import { Users } from '@prisma/client';
import Joi from 'joi';
import AuthSvc from './auth.service';
import { responseSuccess, responseError } from '../../helpers/response.helper';
import logger from '../../utils/logger';

export default class AuthController {
  // Register a new user
  static async register(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      email: Joi.string()
        .email({ tlds: { allow: false } })
        .required(),
      password: Joi.string().min(6).required(),
      firstName: Joi.string().optional(),
      lastName: Joi.string().optional(),
      phoneNumber: Joi.string().optional(),
      roleName: Joi.string().required(),
      countryCode: Joi.string().max(3).optional(),

      sellerDocuments: Joi.object({
        tinIdFileName: Joi.string().required(),
        tinIdKey: Joi.string().required(),
        govIdFileName: Joi.string().required(),
        govIdKey: Joi.string().required(),
      }).when('roleName', {
        is: 'SELLER',
        then: Joi.optional(), // revert to required to return to original logic
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
      email: Joi.string()
        .email({ tlds: { allow: false } })
        .required(),
      password: Joi.string().required(),
      roleName: Joi.string().required(),
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
   * Always answers 200 with the same message, present address or not — see
   * AuthSvc.requestPasswordReset on why enumeration matters more here than
   * a helpful error does.
   */
  static async forgotPassword(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      email: Joi.string()
        .email({ tlds: { allow: false } })
        .required(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const data = await AuthSvc.requestPasswordReset(value.email);
      return responseSuccess(res, 200, data, data.message);
    } catch (error) {
      next(error);
    }
  }

  static async resetPassword(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      email: Joi.string()
        .email({ tlds: { allow: false } })
        .required(),
      // 4 digits, matching the client's OTP field.
      code: Joi.string()
        .pattern(/^\d{4}$/)
        .required()
        .messages({ 'string.pattern.base': 'The reset code must be 4 digits.' }),
      newPassword: Joi.string().min(8).required(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const data = await AuthSvc.resetPassword(value);
      return responseSuccess(res, 200, data, data.message);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Google OAuth Sign-In
   *
   * SECURITY — NOT SAFE TO REGISTER AS A ROUTE YET.
   * This handler takes `email` at face value from the request body, so anyone who can reach it
   * could mint tokens for any account by posting that account's address. It is deliberately not
   * wired up in auth.route.ts, and AuthSvc.googleLogin now throws 501 unconditionally so that
   * wiring it up fails loudly instead of opening account takeover.
   *
   * Before re-enabling, replace the body-supplied identity with a verified one:
   *   1. Require an `idToken` from the client instead of `email`/`firstName`/`lastName`/`googleId`.
   *   2. Verify it — `new OAuth2Client(GOOGLE_CLIENT_ID).verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID })`
   *      — and reject anything that fails signature, audience, issuer, or expiry checks.
   *   3. Read email/name/sub from the verified payload only, and require `email_verified`.
   */
  static async googleLogin(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      email: Joi.string()
        .email({ tlds: { allow: false } })
        .required(),
      firstName: Joi.string().optional(),
      lastName: Joi.string().optional(),
      googleId: Joi.string().optional(),
      avatarUrl: Joi.string().optional(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const data = await AuthSvc.googleLogin(value);
      return responseSuccess(res, 200, data, 'Google login successful');
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
