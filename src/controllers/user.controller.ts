import { Request, Response, NextFunction } from 'express';
import UserService from '../services/user.service';
import { responseSuccess, responseError } from '../helpers/response.helper';
import { parsePagination, pageFromRepo } from '../helpers/pagination.helper';

export default class UserController {
  /**
   * GET /api/v1/users/me
   */
  static async getMe(req: Request, res: Response, next: NextFunction) {
    try {
      // Updated to strictly use PascalCase Id
      const userId = req.user?.Id;
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
      return responseSuccess(res, 200, pageFromRepo(result));
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
}