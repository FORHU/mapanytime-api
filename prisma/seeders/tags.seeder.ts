import { PrismaClient } from '@prisma/client';

/**
 * Seed all predefined product tags. These are the only tags allowed in the system.
 * Stays in sync with ALLOWED_PRODUCT_TAGS in src/helpers/product-tags.ts.
 */
export async function seedTags(prisma: PrismaClient) {
  console.log('🌱 Seeding product tags...');

  const tags = [
    'NEW_ARRIVAL',
    'POPULAR',
    'LIMITED_EDITION',
    'BEST_SELLER',
    'TRENDING',
    'ORGANIC',
    'SEASONAL',
    'VEGAN',
    'USED',
  ] as const;

  for (const tagName of tags) {
    await prisma.tags.upsert({
      where: { name: tagName },
      update: {},
      create: { name: tagName },
    });
  }

  console.log(`✅ Seeded ${tags.length} product tags`);
}
