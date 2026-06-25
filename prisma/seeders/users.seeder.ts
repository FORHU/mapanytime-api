import { PrismaClient, UserRole, Prisma } from '@prisma/client';
import crypto from 'crypto';

export async function seedUsers(prisma: PrismaClient) {
  console.log('🌱 Seeding 50,000 Users...');

  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync('Password123', salt, 1000, 64, 'sha512').toString('hex');
  const sharedPassword = `${salt}:${hash}`;

  const BATCH_SIZE = 5000;
  const TOTAL = 50000;

  for (let batch = 0; batch < TOTAL / BATCH_SIZE; batch++) {
    const usersToCreate: Prisma.UsersCreateManyInput[] = Array.from({ length: BATCH_SIZE }).map((_, i) => ({
      email: `luzon_seller_${batch}_${i}@example.com`,
      firstName: `Luzon${batch}_${i}`,
      lastName: 'Merchant',
      role: UserRole.SELLER,
      passwordHash: sharedPassword,
      isEmailVerified: true,
    }));

    if (batch === 0) {
      // Base test accounts
      usersToCreate.push({ email: 'seller@example.com', firstName: 'Test', lastName: 'Seller', role: UserRole.SELLER, passwordHash: sharedPassword, isEmailVerified: true });
      usersToCreate.push({ email: 'admin@example.com', firstName: 'System', lastName: 'Admin', role: UserRole.ADMIN, passwordHash: sharedPassword, isEmailVerified: true });
      usersToCreate.push({ email: 'buyer@example.com', firstName: 'Sara', lastName: 'Smith', role: UserRole.BUYER, passwordHash: sharedPassword, isEmailVerified: true });
    }

    console.log(`Inserting user batch ${batch + 1}...`);
    await prisma.users.createMany({
      data: usersToCreate,
      skipDuplicates: true,
    });
  }
  
  console.log('✅ 50,000 Users safely seeded!');
}
