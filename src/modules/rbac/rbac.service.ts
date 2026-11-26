import RbacRepository from './rbac.repository';
import AuditService from '../audit/audit.service';

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

  static async updateRolePermissions(roleId: string, permissionCodes: string[], actorId?: string) {
    const before = (await RbacService.getRoles()).find((r) => r.id === roleId);

    const permissions = await RbacRepository.findPermissionsByCodes(permissionCodes);
    const permissionIds = permissions.map((p) => p.id);

    await RbacRepository.clearRolePermissions(roleId);

    if (permissionIds.length > 0) {
      await RbacRepository.assignPermissionsToRole(roleId, permissionIds);
    }

    await AuditService.record({
      performedById: actorId,
      action: 'ROLE_PERMISSIONS_UPDATED',
      entityType: 'ROLE',
      entityId: roleId,
      metadata: {
        roleName: before?.roleName,
        before: { permissionCodes: before?.permissionCodes ?? [] },
        after: { permissionCodes: permissions.map((p) => p.code) },
      },
    });
  }

  static async createRole(
    roleName: string,
    description?: string,
    permissionCodes?: string[],
    actorId?: string,
  ) {
    const role = await RbacRepository.createRole(roleName, description);
    let assignedCodes: string[] = [];

    if (permissionCodes && Array.isArray(permissionCodes) && permissionCodes.length > 0) {
      const permissions = await RbacRepository.findPermissionsByCodes(permissionCodes);
      const permissionIds = permissions.map((p) => p.id);
      await RbacRepository.assignPermissionsToRole(role.id, permissionIds);
      assignedCodes = permissions.map((p) => p.code);
    }

    await AuditService.record({
      performedById: actorId,
      action: 'ROLE_CREATED',
      entityType: 'ROLE',
      entityId: role.id,
      metadata: { roleName, description, permissionCodes: assignedCodes },
    });

    return role;
  }
}
