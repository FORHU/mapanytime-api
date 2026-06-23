import { PrismaClient, UserRole } from '@prisma/client';
import crypto from 'crypto';

export async function seedUsers(prisma: PrismaClient) {
  console.log('🌱 Seeding Users...');

  const usersToCreate = [
    {
      Email: 'admin@example.com',
      FirstName: 'System',
      LastName: 'Admin',
      Role: UserRole.ADMIN, 
      PasswordRaw: 'Password123',
      IsEmailVerified: true,
    },
    {
      Email: 'seller@example.com',
      FirstName: 'Grace',
      LastName: 'Piatos',
      Role: UserRole.SELLER,
      PasswordRaw: 'Seller123',
      IsEmailVerified: true,
    },
    {
      Email: 'buyer@example.com',
      FirstName: 'Sara',
      LastName: 'Smith',
      Role: UserRole.BUYER,
      PasswordRaw: 'Buyer123',
      IsEmailVerified: true,
    }
  ];

  for (const userData of usersToCreate) {
    const { PasswordRaw, ...rest } = userData;

    const existingUser = await prisma.users.findUnique({
      where: { Email: rest.Email },
    });

    if (!existingUser) {
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.pbkdf2Sync(PasswordRaw, salt, 1000, 64, 'sha512').toString('hex');
      const hashedPassword = `${salt}:${hash}`;

      await prisma.users.create({
        data: {
          ...rest,
          PasswordHash: hashedPassword,
        },
      });
      console.log(`✅ Created user: ${rest.Email}`);
    } else {
      console.log(`ℹ️ User already exists: ${rest.Email}`);
    }
  }
}