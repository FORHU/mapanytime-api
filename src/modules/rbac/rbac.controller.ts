import { Request, Response, NextFunction } from 'express';
import RbacService from './rbac.service';
import { responseSuccess, responseError } from '../../helpers/response.helper';

export default class RbacController {
  /**
   * Get all permissions in the system
   */
  static async getPermissions(req: Request, res: Response, next: NextFunction) {
    try {
      const permissions = await RbacService.getPermissions();
      return responseSuccess(res, 200, permissions, 'Permissions retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get all roles with their assigned permissions
   */
  static async getRoles(req: Request, res: Response, next: NextFunction) {
    try {
      const roles = await RbacService.getRoles();
      return responseSuccess(res, 200, roles, 'Roles retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update permissions for a given role
   */
  static async updateRolePermissions(req: Request, res: Response, next: NextFunction) {
    const { roleId } = req.params;
    const { permissionCodes } = req.body; // Array of permission strings

    if (!Array.isArray(permissionCodes)) {
      return responseError(res, 400, 'permissionCodes must be an array');
    }

    try {
      await RbacService.updateRolePermissions(roleId, permissionCodes);
      return responseSuccess(res, 200, null, 'Role permissions updated successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create a new custom role
   */
  static async createRole(req: Request, res: Response, next: NextFunction) {
    const { roleName, description, permissionCodes } = req.body;

    if (!roleName) return responseError(res, 400, 'roleName is required');

    try {
      const role = await RbacService.createRole(roleName as string, description, permissionCodes);
      return responseSuccess(res, 201, role, 'Role created successfully');
    } catch (error) {
      next(error);
    }
  }
}
