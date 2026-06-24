import { PrismaClient, UserRole } from '@prisma/client';
import crypto from 'crypto';

export async function seedUsers(prisma: PrismaClient) {
  console.log('🌱 Seeding Users...');

  const usersToCreate = [
    {
      email: 'admin@example.com',
      firstName: 'System',
      lastName: 'Admin',
      role: UserRole.ADMIN, 
      passwordRaw: 'Password123',
      isEmailVerified: true,
    },
    {
      email: 'seller@example.com',
      firstName: 'Grace',
      lastName: 'Piatos',
      role: UserRole.SELLER,
      passwordRaw: 'Seller123',
      isEmailVerified: true,
    },
    {
      email: 'buyer@example.com',
      firstName: 'Sara',
      lastName: 'Smith',
      role: UserRole.BUYER,
      passwordRaw: 'Buyer123',
      isEmailVerified: true,
    }
  ];

  for (const userData of usersToCreate) {
    const { passwordRaw, ...rest } = userData;

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
        },
      });
      console.log(`✅ Created user: ${rest.email}`);
    } else {
      console.log(`ℹ️ User already exists: ${rest.email}`);
    }
  }
}