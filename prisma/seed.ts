import { PrismaClient } from '@prisma/client';
import { seedUsers } from './seeders/users.seeder';
import { seedRoles } from './seeders/roles.seeder';
import { seedCategories } from './seeders/categories.seeder';
import { seedPaymentProviders } from './seeders/payments.seeder';
import { seedPricingConfiguration } from './seeders/pricing.seeder';
import { seedStoresAndProducts } from './seeders/stores_and_products.seeder';
import { seedMarketplaceData } from './seeders/marketplace_data.seeder';
import { seedMultiStoreSeller } from './seeders/multi_store_seller.seeder';
import { seedTags } from './seeders/tags.seeder';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting modular database seeding...');

  try {
    // Execution order matters due to foreign key constraints
    await seedRoles(prisma);
    await seedUsers(prisma);
    await seedCategories(prisma);
    await seedTags(prisma);
    await seedPaymentProviders(prisma);
    await seedPricingConfiguration(prisma);
    await seedStoresAndProducts(prisma);
    await seedMarketplaceData(prisma);
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
