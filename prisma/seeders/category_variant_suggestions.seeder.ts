import { PrismaClient } from '@prisma/client';

/**
 * Suggested product-option names per category — the dropdown a seller sees in
 * the option builder ("Size", "Color", "Alcohol Level"…).
 *
 * These are HINTS ONLY. Nothing here constrains what a seller may create: the
 * builder always offers an "Others…" free-text escape, and a category with no
 * suggestions is a normal, supported state.
 *
 * Inheritance: a root's list is merged into every sub-category beneath it at
 * read time (CategoryService.getVariantSuggestions), so a sub-category lists
 * only what is specific to it. A sub-category re-declaring a root's name wins
 * and keeps its own position.
 *
 * Category names are the REAL seeded taxonomy from categories.seeder.ts. Note
 * there is no "Clothing", "Shoes" or "Furniture" ROOT — those live under
 * Shopping & Retail and Home & Living. Keyed by root because sub-category names
 * are only unique within a parent.
 */
const SUGGESTIONS_BY_ROOT: {
  root: string;
  /** Applies to the root itself and is inherited by all of its sub-categories. */
  rootSuggestions?: string[];
  subCategories?: Record<string, string[]>;
}[] = [
  {
    root: 'Shopping & Retail',
    rootSuggestions: ['Color'],
    subCategories: {
      Fashion: ['Size', 'Color', 'Fit', 'Material', 'Sleeve Length'],
      Shoes: ['Size', 'Color', 'Width', 'Material'],
      Bags: ['Size', 'Color', 'Material'],
      Accessories: ['Size', 'Color', 'Material'],
      Jewelry: ['Size', 'Material', 'Color'],
      Watches: ['Color', 'Band Material', 'Case Size'],
    },
  },
  {
    root: 'Food & Beverage',
    rootSuggestions: ['Size'],
    subCategories: {
      Restaurant: ['Size', 'Flavor', 'Spice Level', 'Serving Size'],
      Cafe: ['Size', 'Flavor', 'Temperature', 'Milk Type', 'Sweetness'],
      'Fast Food': ['Size', 'Flavor', 'Meal Type', 'Serving Size'],
      Grocery: ['Size', 'Flavor', 'Pack Size'],
      Fruits: ['Size', 'Weight', 'Ripeness', 'Pack Size'],
      Vegetables: ['Size', 'Weight', 'Freshness', 'Pack Size'],
      Seafood: ['Size', 'Weight', 'Cut', 'Fresh/Frozen'],
      Meat: ['Cut', 'Weight', 'Grade', 'Fresh/Frozen'],
      Dairy: ['Flavor', 'Size', 'Fat Level', 'Pack Size'],
      Beverages: ['Brand', 'Flavor', 'Size', 'Temperature', 'Pack Size'],
      Liquor: ['Type', 'Volume', 'Alcohol Content'],
    },
  },
  {
    root: 'Electronics',
    // Electronics is itself a root here, so the template lives at root level.
    rootSuggestions: ['Storage', 'RAM', 'Color', 'Model', 'Version'],
    subCategories: {
      'Mobile Phones': ['Storage', 'RAM', 'Color', 'Model'],
      Computers: ['Storage', 'RAM', 'Processor', 'Screen Size'],
    },
  },
  {
    root: 'Home & Living',
    rootSuggestions: ['Color', 'Material'],
    subCategories: {
      Furniture: ['Material', 'Color', 'Size', 'Finish', 'Configuration', 'Fabric Type'],
      Bedding: ['Size', 'Color', 'Material'],
      Kitchen: ['Size', 'Color', 'Material'],
    },
  },
];

export async function seedCategoryVariantSuggestions(prisma: PrismaClient) {
  console.log('🌱 Seeding category variant suggestions...');

  let seeded = 0;
  let pruned = 0;

  const upsertFor = async (categoryId: string, names: string[]) => {
    for (const [index, name] of names.entries()) {
      // A real upsert works here, unlike in categories.seeder.ts. That file uses
      // findFirst because @@unique([parentId, name]) is unenforceable among
      // roots (Postgres treats NULL parentIds as distinct). `categoryId` here is
      // NOT NULL, so @@unique([categoryId, name]) is fully enforced.
      await prisma.categoryVariantSuggestions.upsert({
        where: { categoryId_name: { categoryId, name } },
        update: { position: index },
        create: { categoryId, name, position: index },
      });
      seeded += 1;
    }

    // Prune anything no longer in the list. Upsert alone is idempotent for
    // ADDITIONS only — without this, a name removed from the data above stays
    // in the database forever and keeps showing up in the seller's dropdown.
    // This list IS the configuration, so the seeder has to be authoritative
    // over it rather than merely additive.
    const removed = await prisma.categoryVariantSuggestions.deleteMany({
      where: { categoryId, name: { notIn: names } },
    });
    pruned += removed.count;
  };

  for (const entry of SUGGESTIONS_BY_ROOT) {
    const root = await prisma.categories.findFirst({
      where: { name: entry.root, parentId: null, deletedAt: null },
    });

    if (!root) {
      // Warn rather than throw: a partially seeded database should not abort the
      // whole run over optional form metadata.
      console.warn(`  ⚠️  Root category "${entry.root}" not found — skipped.`);
      continue;
    }

    if (entry.rootSuggestions) await upsertFor(root.id, entry.rootSuggestions);

    for (const [subName, names] of Object.entries(entry.subCategories ?? {})) {
      const sub = await prisma.categories.findFirst({
        where: { name: subName, parentId: root.id, deletedAt: null },
      });

      if (!sub) {
        console.warn(`  ⚠️  Sub-category "${entry.root} > ${subName}" not found — skipped.`);
        continue;
      }

      await upsertFor(sub.id, names);
    }
  }

  console.log(
    `✅ Seeded ${seeded} category variant suggestions` +
      (pruned > 0 ? ` (pruned ${pruned} stale)` : ''),
  );
}
