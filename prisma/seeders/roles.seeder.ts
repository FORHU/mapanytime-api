import { PrismaClient } from '@prisma/client';
import {
  SYSTEM_ROLES,
  ADMIN_ROLES,
  ROLE_DESCRIPTIONS,
  SystemRole,
} from '../../src/constants/roles.constant';
import {
  SYSTEM_PERMISSIONS,
  NON_ADMIN_ROLE_PERMISSIONS,
} from '../../src/constants/permissions.constant';

interface PermissionSeederRecord {
  id: string;
  code: string;
  name: string;
  description?: string | null;
}

export async function seedRoles(prisma: PrismaClient) {
  console.log('🌱 Seeding Master Roles & Granular Permissions...');

  // Catalogue lives in src/constants/permissions.constant.ts so the codes the
  // route gates reference and the codes seeded here are the same list.
  const systemPermissions = SYSTEM_PERMISSIONS;

  const seededPermissions: Record<string, string> = {};

  const prismaExtended = prisma as unknown as {
    permissions: {
      upsert: (args: unknown) => Promise<PermissionSeederRecord>;
    };
    rolePermissions: {
      upsert: (args: unknown) => Promise<unknown>;
    };
  };

  for (const perm of systemPermissions) {
    const created = await prismaExtended.permissions.upsert({
      where: { code: perm.code },
      update: { name: perm.name, description: perm.description },
      create: perm,
    });
    seededPermissions[perm.code] = created.id;
  }

  // Iterates SYSTEM_ROLES directly — adding a role there is enough for it to
  // reach the DB; ROLE_DESCRIPTIONS being Record<SystemRole, string> means a
  // missing description is a compile error, not a role that silently never
  // gets created.
  for (const roleName of Object.values(SYSTEM_ROLES)) {
    const role = await prisma.roles.upsert({
      where: { roleName },
      update: { description: ROLE_DESCRIPTIONS[roleName] },
      create: { roleName, description: ROLE_DESCRIPTIONS[roleName] },
    });

    // Administrators get every seeded permission; everyone else gets whatever
    // NON_ADMIN_ROLE_PERMISSIONS lists for them (nothing, if unlisted).
    const assignedCodes: string[] = ADMIN_ROLES.includes(roleName as SystemRole)
      ? Object.keys(seededPermissions)
      : (NON_ADMIN_ROLE_PERMISSIONS[roleName as SystemRole] ?? []);

    for (const code of assignedCodes) {
      const permId = seededPermissions[code];
      if (permId) {
        await prismaExtended.rolePermissions.upsert({
          where: {
            roleId_permissionId: {
              roleId: role.id,
              permissionId: permId,
            },
          },
          update: {},
          create: {
            roleId: role.id,
            permissionId: permId,
          },
        });
      }
    }
  }

  console.log('✅ All master roles & granular permission matrixes verified.');
}
