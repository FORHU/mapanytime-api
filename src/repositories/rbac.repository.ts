import { prisma } from '../utils/prisma';

export default class RbacRepository {
  static async getAllPermissions() {
    return prisma.permissions.findMany({
      orderBy: { code: 'asc' },
    });
  }

  static async getAllRolesWithPermissions() {
    return prisma.roles.findMany({
      include: {
        permissions: {
          include: { permission: true },
        },
      },
      orderBy: { roleName: 'asc' },
    });
  }

  static async findPermissionsByCodes(codes: string[]) {
    return prisma.permissions.findMany({
      where: { code: { in: codes } },
    });
  }

  static async clearRolePermissions(roleId: string) {
    return prisma.rolePermissions.deleteMany({
      where: { roleId },
    });
  }

  static async assignPermissionsToRole(roleId: string, permissionIds: string[]) {
    const mappings = permissionIds.map((id) => ({
      roleId,
      permissionId: id,
    }));
    
    return prisma.rolePermissions.createMany({
      data: mappings,
    });
  }

  static async createRole(roleName: string, description?: string) {
    return prisma.roles.create({
      data: {
        roleName: roleName.toUpperCase(),
        description,
      },
    });
  }
}
