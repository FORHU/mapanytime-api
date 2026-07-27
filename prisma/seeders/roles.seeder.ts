import { PrismaClient } from '@prisma/client';

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
    { roleName: 'BUYER', description: 'Buyer account for map discovery and local checkout' },
    {
      roleName: 'SELLER',
      description: 'Merchant seller account for managing storefronts and catalog',
    },
    { roleName: 'ADMIN', description: 'Platform super administrator with full system permissions' },
    {
      roleName: 'SUPPORT_AGENT',
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
    if (roleData.roleName === 'ADMIN') {
      assignedCodes = Object.keys(seededPermissions);
    } else if (roleData.roleName === 'SELLER') {
      assignedCodes = ['stores.manage', 'orders.view', 'analytics.view'];
    } else if (roleData.roleName === 'SUPPORT_AGENT') {
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
