import { Request, Response, NextFunction } from 'express';
import UserService from './user.service';
import { responseSuccess, responseError } from '../../helpers/response.helper';
import { parsePagination } from '../../helpers/pagination.helper';

export default class UserController {
  /**
   * GET /api/v1/users/me
   */
  static async getMe(req: Request, res: Response, next: NextFunction) {
    try {
      // Updated to strictly use PascalCase Id
      const userId = req.user?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized');

      const user = await UserService.getUser(userId);
      return responseSuccess(res, 200, user);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/users
   */
  static async index(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit } = parsePagination(req.query as Record<string, unknown>);
      const result = await UserService.listUsers(page, limit);
      return responseSuccess(res, 200, result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/users/:userId
   */
  static async show(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId } = req.params;
      const user = await UserService.getUser(userId);
      return responseSuccess(res, 200, user);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/users
   */
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const newUser = await UserService.createUser(req.body);
      return responseSuccess(res, 201, newUser, 'User created successfully');
    } catch (error) {
      next(error);
    }
  }

  static async assignRole(req: Request, res: Response, next: NextFunction) {
    try {
      // Use Id (capital I) to match your getMe method
      const userId = req.body.userId || req.user?.id;
      if (!userId) return responseError(res, 401, 'Unauthorized');

      const { roleName } = req.body;
      if (!roleName) return responseError(res, 400, 'roleName is required');

      await UserService.assignRole(userId, roleName);

      return responseSuccess(res, 200, null, `Role ${roleName} assigned successfully`);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/v1/users/:userId/roles
   */
  static async updateUserRoles(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId } = req.params;
      const { roleNames } = req.body;

      if (!Array.isArray(roleNames)) {
        return responseError(res, 400, 'roleNames must be an array');
      }

      const user = await UserService.setUserRoles(userId, roleNames);

      return responseSuccess(res, 200, user, 'User roles updated successfully');
    } catch (error) {
      next(error);
    }
  }
}
