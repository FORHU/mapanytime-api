import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

export async function seedUsers(prisma: PrismaClient) {
  console.log('🌱 Seeding Users...');

  const usersToCreate = [
    {
      email: 'admin@example.com',
      firstName: 'System',
      lastName: 'Admin',
      roles: ['ADMIN'],
      passwordRaw: 'Password123',
      isEmailVerified: true,
    },
    {
      email: 'seller@example.com',
      firstName: 'Grace',
      lastName: 'Piatos',
      roles: ['SELLER'],
      passwordRaw: 'Seller123',
      isEmailVerified: true,
    },
    {
      email: 'buyer@example.com',
      firstName: 'Sara',
      lastName: 'Smith',
      roles: ['BUYER'],
      passwordRaw: 'Buyer123',
      isEmailVerified: true,
    },
    {
      email: 'dual@example.com',
      firstName: 'Alex',
      lastName: 'Mercer',
      roles: ['BUYER', 'SELLER'],
      passwordRaw: 'Dual123',
      isEmailVerified: true,
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
      console.log(`ℹ️ User already exists: ${rest.email}`);
    }
  }
}
