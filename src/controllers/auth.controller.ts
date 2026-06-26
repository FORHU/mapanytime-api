import { Request, Response, NextFunction } from 'express';
import { Users } from '@prisma/client';
import Joi from 'joi';
import AuthSvc from '../services/auth.service';

export default class AuthController {
  /**
   * Register a new user
   */
  static async register(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      email: Joi.string().email().required(),
      password: Joi.string().min(6).required(),
      name: Joi.string().optional(),
      roleName: Joi.string().required(),
      countryCode: Joi.string().max(3).optional(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ message: error.message });

    try {
      const data = await AuthSvc.register(value);
      return res.status(201).json({
        status: 'success',
        statusCode: 201,
        message: 'User created successfully',
        data,
      });
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
    if (error) return res.status(400).json({ message: error.message });

    try {
      const data = await AuthSvc.login(value);
      return res.status(200).json({
        status: 'success',
        statusCode: 200,
        message: 'Login successful',
        data,
      });
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
    if (error) return res.status(400).json({ message: error.message });

    try {
      const data = await AuthSvc.refreshToken(value.refreshToken);
      return res.status(200).json({
        status: 'success',
        statusCode: 200,
        message: 'Token refreshed successfully',
        data,
      });
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

      if (!userId) {
        return res.status(401).json({
          status: 'error',
          statusCode: 401,
          message: 'Unauthorized',
        });
      }

      const result = await AuthSvc.logout(userId, refreshToken);

      return res.status(200).json({
        status: 'success',
        statusCode: 200,
        message: result.message,
        data: {},
      });
    } catch (error) {
      next(error);
    }
  }
}
