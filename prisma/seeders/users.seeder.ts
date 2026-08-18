import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { SYSTEM_ROLES } from '../../src/constants/roles.constant';

export async function seedUsers(prisma: PrismaClient) {
  console.log('🌱 Seeding base users...');

  const defaultRoles = Object.values(SYSTEM_ROLES);
  for (const roleName of defaultRoles) {
    await prisma.roles.upsert({
      where: { roleName },
      update: {},
      create: {
        roleName,
        description: `Default ${roleName} role`,
      },
    });
  }
  console.log('✅ Base roles seeded!');

  const usersToCreate = [
    {
      email: 'superadmin@example.com',
      firstName: 'Super',
      lastName: 'Admin',
      roles: [SYSTEM_ROLES.SUPER_ADMIN],
      passwordRaw: 'Super123',
      isEmailVerified: true,
      countryCode: 'PH',
    },
    {
      email: 'dev@example.com',
      firstName: 'Lead',
      lastName: 'Developer',
      roles: [SYSTEM_ROLES.DEVELOPER],
      passwordRaw: 'Dev123',
      isEmailVerified: true,
      countryCode: 'PH',
    },
    {
      email: 'admin@example.com',
      firstName: 'System',
      lastName: 'Admin',
      roles: [SYSTEM_ROLES.ADMIN],
      passwordRaw: 'Password123',
      isEmailVerified: true,
      countryCode: 'PH',
    },
    {
      email: 'seller@example.com',
      firstName: 'Grace',
      lastName: 'Piatos',
      roles: ['SELLER'],
      passwordRaw: 'Seller123',
      isEmailVerified: true,
      countryCode: 'PH',
    },
    {
      email: 'seller.electrical@mapanytime.test',
      firstName: 'Jose',
      lastName: 'Electrico',
      roles: ['SELLER'],
      passwordRaw: 'Seller123',
      isEmailVerified: true,
      countryCode: 'PH',
    },
    {
      email: 'seller.hardware@mapanytime.test',
      firstName: 'Ramon',
      lastName: 'Construccion',
      roles: ['SELLER'],
      passwordRaw: 'Seller123',
      isEmailVerified: true,
      countryCode: 'PH',
    },
    {
      email: 'support@mapanytime.test',
      firstName: 'Maria',
      lastName: 'Artesano',
      roles: ['SUPPORT_AGENT'],
      passwordRaw: 'Support123',
      isEmailVerified: true,
      countryCode: 'PH',
    },
    {
      email: 'buyer@example.com',
      firstName: 'Sara',
      lastName: 'Smith',
      roles: ['BUYER'],
      passwordRaw: 'Buyer123',
      isEmailVerified: true,
      countryCode: 'PH',
    },
    {
      email: 'dual@example.com',
      firstName: 'Alex',
      lastName: 'Mercer',
      roles: ['BUYER', 'SELLER'],
      passwordRaw: 'Dual123',
      isEmailVerified: true,
      countryCode: 'PH',
    },
    {
      email: 'seller.multistore@mapanytime.test',
      firstName: 'Marco',
      lastName: 'Cordillera',
      roles: ['SELLER', 'BUYER'],
      passwordRaw: 'Seller123',
      isEmailVerified: true,
      countryCode: 'PH',
    },
  ];

  for (const userData of usersToCreate) {
    const { passwordRaw, roles, ...rest } = userData;

    let user = await prisma.users.findUnique({
      where: { email: rest.email },
    });

    if (!user) {
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.pbkdf2Sync(passwordRaw, salt, 1000, 64, 'sha512').toString('hex');
      const hashedPassword = `${salt}:${hash}`;

      user = await prisma.users.create({
        data: {
          ...rest,
          passwordHash: hashedPassword,
          roles: {
            connect: roles.map((roleName: string) => ({ roleName })),
          },
        },
      });
      console.log(`✅ Created user: ${rest.email}`);
    } else {
      console.log(`ℹ️  User already exists: ${rest.email}`);
    }

    // Ensure Buyer record exists for user
    await prisma.buyers.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        displayName: `${user.firstName} ${user.lastName}`.trim() || user.email,
      },
    });

    // Ensure Seller record exists for seller/admin roles
    const isSeller = roles.some((r) =>
      ['SELLER', 'ADMIN', 'SUPER_ADMIN', 'SUPPORT_AGENT'].includes(r),
    );
    if (isSeller) {
      await prisma.sellers.upsert({
        where: { userId: user.id },
        update: {
          applicationStatus: 'APPROVED',
          onboardingStep: 4,
        },
        create: {
          userId: user.id,
          applicationStatus: 'APPROVED',
          onboardingStep: 4,
          sellerPlan: 'PRO',
        },
      });
    }
  }

  console.log('✅ Base users, buyers, and sellers seeded!');
}
