import { PrismaClient } from '@prisma/client';
import { SYSTEM_ROLES, ADMIN_ROLES, SystemRole } from '../../src/constants/roles.constant';

interface PermissionSeederRecord {
  id: string;
  code: string;
  name: string;
  description?: string | null;
}

export async function seedRoles(prisma: PrismaClient) {
  console.log('🌱 Seeding Master Roles & Granular Permissions...');

  const systemPermissions = [
    {
      code: 'stores.approve',
      name: 'Approve Merchant Stores',
      description: 'Can review and verify pending seller store requests',
    },
    {
      code: 'stores.manage',
      name: 'Manage Store Listings',
      description: 'Can create, edit, or suspend merchant stores',
    },
    {
      code: 'categories.manage',
      name: 'Manage Categories',
      description: 'Can create, edit, and toggle marketplace categories',
    },
    {
      code: 'users.manage',
      name: 'Manage Users',
      description: 'Can view and modify user profiles and account statuses',
    },
    {
      code: 'users.roles',
      name: 'Manage Roles & RBAC',
      description: 'Can assign roles and modify permission matrixes',
    },
    {
      code: 'orders.view',
      name: 'View System Orders',
      description: 'Can monitor platform-wide buyer orders and pickup schedules',
    },
    {
      code: 'analytics.view',
      name: 'View Platform Analytics',
      description: 'Can access gross merchandise volume and revenue charts',
    },
  ];

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
      assignedCodes = ['stores.manage', 'orders.view', 'analytics.view'];
    } else if (roleData.roleName === SYSTEM_ROLES.SUPPORT_AGENT) {
      assignedCodes = ['orders.view', 'stores.manage'];
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
