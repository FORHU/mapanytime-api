import { Request, Response, NextFunction } from 'express';
import { Users } from '@prisma/client';
import Joi from 'joi';
import AuthSvc from './auth.service';
import { responseSuccess, responseError } from '../../helpers/response.helper';
import logger from '../../utils/logger';

/**
 * Collapse a Joi result into the `details` map the API error contract specifies:
 * `{ field: [message, ...] }`. Clients bind these to form fields, so the key has to
 * be the field name the client rendered — hence `error.details[].path[0]` rather
 * than Joi's flattened `error.message`, which names the field inside prose.
 *
 * Pairs with `abortEarly: false`; with the default `true` this map would never hold
 * more than a single entry and the user would fix one field per round-trip.
 */
function fieldErrors(error: Joi.ValidationError): Record<string, string[]> {
  return error.details.reduce<Record<string, string[]>>((acc, detail) => {
    const field = String(detail.path[0] ?? '_');
    (acc[field] ||= []).push(detail.message);
    return acc;
  }, {});
}

const VALIDATE_OPTS: Joi.ValidationOptions = {
  // Report every bad field at once rather than one per request.
  abortEarly: false,
  // Drop unrecognised keys instead of rejecting. Joi's default is to 400 on any
  // extra property, which turns an additive client change (a device id, an
  // analytics field) into a login outage for that client.
  stripUnknown: true,
};

export default class AuthController {
  // Register a new user
  static async register(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      // Normalised on the way in so the case-insensitive lookup in
      // AuthRepo.findUserByEmail never has to arbitrate between two stored spellings.
      email: Joi.string()
        .trim()
        .lowercase()
        .email({ tlds: { allow: false } })
        .required(),
      password: Joi.string().min(8).max(128).required(),
      firstName: Joi.string().required(),
      lastName: Joi.string().required(),
      middleName: Joi.string().optional(),
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
        .trim()
        .lowercase()
        .email({ tlds: { allow: false } })
        .required()
        .messages({
          'string.email': 'Enter a valid email address.',
          'string.empty': 'Email is required.',
          'any.required': 'Email is required.',
        }),
      // Shape only — deliberately NOT the register/reset strength policy. A user whose
      // stored password predates a strength rule must still be able to sign in, and a
      // 400 that names the policy hands it to an attacker for free. Strength belongs on
      // register and reset, where it can actually be satisfied. `max` is a PBKDF2 cost
      // guard, not a business rule.
      password: Joi.string().min(1).max(128).required().messages({
        'string.empty': 'Password is required.',
        'string.max': 'Password is too long.',
        'any.required': 'Password is required.',
      }),
      roleName: Joi.string().required().messages({
        'string.empty': 'Role is required.',
        'any.required': 'Role is required.',
      }),
    });

    const { error, value } = schema.validate(req.body, VALIDATE_OPTS);
    if (error) {
      return responseError(res, 422, 'Please correct the highlighted fields.', {
        details: fieldErrors(error),
      });
    }

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

      code: Joi.string()
        .pattern(/^(\d{4}|[0-9a-f]{24})$/)
        .required()
        .messages({
          'string.pattern.base': 'That code is not in a recognised format.',
        }),
      newPassword: Joi.string().min(8).max(128).required(),
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
   * Logout — idempotent by contract.
   *
   * Anything short of "you are not authenticated at all" answers 200, including a
   * missing, unknown, or already-revoked refresh token. The access token in the
   * Authorization header is what identifies the session to kill; the body token is
   * only a hint about *which* refresh row to drop.
   *
   * This is load-bearing for the Flutter client: its repository treats any non-401,
   * non-network error from this endpoint as a failure and deliberately keeps the user
   * signed in, so a 400 here would leave mobile users with a Logout button that can
   * never succeed. Under the single-active-device policy a stale refresh token is the
   * normal case, not an exceptional one.
   */
  static async logout(req: Request, res: Response, next: NextFunction) {
    try {
      const schema = Joi.object({
        refreshToken: Joi.string().allow('', null).optional(),
      });

      // Ignore a malformed body outright rather than rejecting it — see above.
      const { value } = schema.validate(req.body ?? {}, VALIDATE_OPTS);
      const refreshToken = value?.refreshToken || undefined;
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
