import { PrismaClient } from '@prisma/client';

export async function seedRoles(prisma: PrismaClient) {
  console.log('🌱 Seeding Roles...');

  const roles = [
    { roleName: 'USER', description: 'Standard registered user' },
    { roleName: 'BUYER', description: 'User who can make purchases' },
    { roleName: 'SELLER', description: 'User who can manage a store and list products' },
    { roleName: 'ADMIN', description: 'System administrator' },
  ];

  for (const role of roles) {
    await prisma.roles.upsert({
      where: { roleName: role.roleName },
      update: {},
      create: role,
    });
  }
  console.log('✅ All master roles verified.');
}
