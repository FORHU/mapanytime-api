import { PrismaClient } from '@prisma/client';
import { seedUsers } from './seeders/users.seeder';
import { seedRoles } from './seeders/roles.seeder';
import { seedCategories } from './seeders/categories.seeder';
import { seedMarketplaceData } from './seeders/marketplace_data.seeder';
import { seedPaymentProviders } from './seeders/payments.seeder';
import { seedMultiStoreSeller } from './seeders/multi_store_seller.seeder';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting modular database seeding...');

  try {
    // Execution order matters due to foreign key constraints
    await seedRoles(prisma);
    await seedUsers(prisma);
    await seedCategories(prisma);
    await seedPaymentProviders(prisma);
    await seedMarketplaceData(prisma);
    // Runs last, deliberately. seedMarketplaceData picks its fixtures with
    // `stores.findMany()` and indexes into [0] and [1], so seeding these four
    // stores earlier would silently re-point its orders, payments and
    // reservations at them and destroy the clean scenario this fixture is for.
    await seedMultiStoreSeller(prisma);

    console.log('All seeder modules executed successfully!');
  } catch (error) {
    console.error('Seeding failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
