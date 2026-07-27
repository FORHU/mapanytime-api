import { Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { responseSuccess, responseError } from '../helpers/response.helper';

interface PermissionRecord {
  id: string;
  code: string;
  name: string;
  description?: string | null;
}

interface RoleWithPermissions {
  id: string;
  roleName: string;
  description?: string | null;
  permissions: Array<{
    permission: PermissionRecord;
  }>;
}

export default class RbacController {
  /**
   * Get all permissions in the system
   */
  static async getPermissions(req: Request, res: Response, next: NextFunction) {
    try {
      const permissions = await (
        prisma as unknown as {
          permissions: { findMany: (args: unknown) => Promise<PermissionRecord[]> };
        }
      ).permissions.findMany({
        orderBy: { code: 'asc' },
      });
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
      const roles = (await prisma.roles.findMany({
        include: {
          permissions: {
            include: {
              permission: true,
            },
          },
        },
        orderBy: { roleName: 'asc' },
      })) as unknown as RoleWithPermissions[];

      const formatted = roles.map((r) => ({
        id: r.id,
        roleName: r.roleName,
        description: r.description,
        permissionCodes: r.permissions.map((rp) => rp.permission.code),
      }));

      return responseSuccess(res, 200, formatted, 'Roles retrieved successfully');
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
      const prismaExtended = prisma as unknown as {
        rolePermissions: {
          deleteMany: (args: unknown) => Promise<unknown>;
          createMany: (args: unknown) => Promise<unknown>;
        };
        permissions: {
          findMany: (args: unknown) => Promise<PermissionRecord[]>;
        };
      };

      // Clear current permissions for the role
      await prismaExtended.rolePermissions.deleteMany({
        where: { roleId },
      });

      // Find permission IDs by codes
      const permissions = await prismaExtended.permissions.findMany({
        where: { code: { in: permissionCodes } },
      });

      // Insert new permission mappings
      const newMappings = permissions.map((p) => ({
        roleId,
        permissionId: p.id,
      }));

      if (newMappings.length > 0) {
        await prismaExtended.rolePermissions.createMany({
          data: newMappings,
        });
      }

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
      const role = await prisma.roles.create({
        data: {
          roleName: (roleName as string).toUpperCase(),
          description,
        },
      });

      if (Array.isArray(permissionCodes) && permissionCodes.length > 0) {
        const prismaExtended = prisma as unknown as {
          rolePermissions: {
            createMany: (args: unknown) => Promise<unknown>;
          };
          permissions: {
            findMany: (args: unknown) => Promise<PermissionRecord[]>;
          };
        };

        const permissions = await prismaExtended.permissions.findMany({
          where: { code: { in: permissionCodes } },
        });

        const mappings = permissions.map((p) => ({
          roleId: role.id,
          permissionId: p.id,
        }));

        await prismaExtended.rolePermissions.createMany({
          data: mappings,
        });
      }

      return responseSuccess(res, 201, role, 'Role created successfully');
    } catch (error) {
      next(error);
    }
  }
}
