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
  ];

  for (const userData of usersToCreate) {
    const { passwordRaw, roles, ...rest } = userData;

    const existingUser = await prisma.users.findUnique({
      where: { email: rest.email },
    });

    if (!existingUser) {
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.pbkdf2Sync(passwordRaw, salt, 1000, 64, 'sha512').toString('hex');
      const hashedPassword = `${salt}:${hash}`;

      await prisma.users.create({
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
  }

  console.log('✅ Base users seeded!');
}
