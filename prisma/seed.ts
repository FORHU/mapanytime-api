import { PrismaClient } from '@prisma/client';
import { seedUsers } from './seeders/users.seeder';
import { seedRoles } from './seeders/roles.seeder';
import { seedCategories } from './seeders/categories.seeder';
import { seedCategoryVariantSuggestions } from './seeders/category_variant_suggestions.seeder';
import { seedPaymentProviders } from './seeders/payments.seeder';
import { seedPricingConfiguration } from './seeders/pricing.seeder';
import { seedStoresAndProducts } from './seeders/stores_and_products.seeder';
import { seedMarketplaceData } from './seeders/marketplace_data.seeder';
import { seedMultiStoreSeller } from './seeders/multi_store_seller.seeder';
import { seedTags } from './seeders/tags.seeder';
import { seedBulkMapStores } from './seeders/bulk_map_stores.seeder';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting modular database seeding...');

  try {
    // Execution order matters due to foreign key constraints
    await seedRoles(prisma);
    await seedUsers(prisma);
    await seedCategories(prisma);
    // Depends only on Categories, and keeps the taxonomy block contiguous.
    await seedCategoryVariantSuggestions(prisma);
    await seedTags(prisma);
    await seedPaymentProviders(prisma);
    await seedPricingConfiguration(prisma);
    await seedStoresAndProducts(prisma);
    await seedMarketplaceData(prisma);
    await seedMultiStoreSeller(prisma);
    await seedBulkMapStores(prisma);

    console.log('All seeder modules executed successfully!');
  } catch (error) {
    console.error('Seeding failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
