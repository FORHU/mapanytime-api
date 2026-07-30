import RbacRepository from '../repositories/rbac.repository';

export default class RbacService {
  static async getPermissions() {
    return RbacRepository.getAllPermissions();
  }

  static async getRoles() {
    const roles = await RbacRepository.getAllRolesWithPermissions();
    return roles.map((r) => ({
      id: r.id,
      roleName: r.roleName,
      description: r.description,
      permissionCodes: r.permissions.map((rp) => rp.permission.code),
    }));
  }

  static async updateRolePermissions(roleId: string, permissionCodes: string[]) {
    const permissions = await RbacRepository.findPermissionsByCodes(permissionCodes);
    const permissionIds = permissions.map((p) => p.id);

    await RbacRepository.clearRolePermissions(roleId);
    
    if (permissionIds.length > 0) {
      await RbacRepository.assignPermissionsToRole(roleId, permissionIds);
    }
  }

  static async createRole(roleName: string, description?: string, permissionCodes?: string[]) {
    const role = await RbacRepository.createRole(roleName, description);

    if (permissionCodes && Array.isArray(permissionCodes) && permissionCodes.length > 0) {
      const permissions = await RbacRepository.findPermissionsByCodes(permissionCodes);
      const permissionIds = permissions.map((p) => p.id);
      await RbacRepository.assignPermissionsToRole(role.id, permissionIds);
    }

    return role;
  }
}