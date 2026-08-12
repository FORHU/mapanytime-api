import { PrismaClient } from '@prisma/client';
import { SYSTEM_ROLES, ADMIN_ROLES, SystemRole } from '../../src/constants/roles.constant';
import { PERMISSIONS, SYSTEM_PERMISSIONS } from '../../src/constants/permissions.constant';

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

  const roles = [
    {
      roleName: SYSTEM_ROLES.SUPER_ADMIN,
      description:
        'Platform super administrator with unrestricted system control and invite privileges',
    },
    {
      roleName: SYSTEM_ROLES.DEVELOPER,
      description:
        'Platform software engineer with access to system API logs, webhooks, and developer tools',
    },
    {
      roleName: SYSTEM_ROLES.BUYER,
      description: 'Buyer account for map discovery and local checkout',
    },
    {
      roleName: SYSTEM_ROLES.SELLER,
      description: 'Merchant seller account for managing storefronts and catalog',
    },
    {
      roleName: SYSTEM_ROLES.ADMIN,
      description: 'Platform administrator with system management permissions',
    },
    {
      roleName: SYSTEM_ROLES.SUPPORT_AGENT,
      description: 'Customer support agent for reviewing orders and store inquiries',
    },
  ];

  for (const roleData of roles) {
    const role = await prisma.roles.upsert({
      where: { roleName: roleData.roleName },
      update: { description: roleData.description },
      create: roleData,
    });

    // Assign default permissions to roles
    let assignedCodes: string[] = [];
    if (ADMIN_ROLES.includes(roleData.roleName as SystemRole)) {
      assignedCodes = Object.keys(seededPermissions);
    } else if (roleData.roleName === SYSTEM_ROLES.SELLER) {
      assignedCodes = [
        PERMISSIONS.STORES_MANAGE,
        PERMISSIONS.ORDERS_VIEW,
        PERMISSIONS.ANALYTICS_VIEW,
      ];
    } else if (roleData.roleName === SYSTEM_ROLES.SUPPORT_AGENT) {
      assignedCodes = [PERMISSIONS.ORDERS_VIEW, PERMISSIONS.STORES_MANAGE];
    }

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
