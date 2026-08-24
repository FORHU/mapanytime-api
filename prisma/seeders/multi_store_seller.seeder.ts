import { PrismaClient, ApplicationStatus, STOREAPPROVALSTATUS } from '@prisma/client';

/**
 * One seller owning four stores: three approved and stocked, one still awaiting
 * approval with no products at all.
 *
 * The empty pending store is the point of this fixture. Most screens are only
 * ever exercised against a store that has both approval and stock, so the two
 * states that break them — "not approved yet" and "approved but nothing in it" —
 * go untested. Having all four under a single login also exercises the store
 * switcher, which needs more than one store to do anything at all.
 *
 * Idempotent: stores are upserted on their unique slug, and products are only
 * created for a store that has none, so re-running never duplicates or clobbers
 * rows that orders may already point at.
 */

const SELLER_EMAIL = 'seller.multistore@mapanytime.test';
const SELLER_PASSWORD = 'Seller123';

/** Mon–Sat 08:00–19:00, closed Sunday. */
const WEEKLY_HOURS = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
  dayOfWeek,
  openMinutes: 8 * 60,
  closeMinutes: 19 * 60,
  isClosed: dayOfWeek === 0,
}));

type StoreSpec = {
  slug: string;
  storeName: string;
  description: string;
  categoryName: string;
  approvalStatus: STOREAPPROVALSTATUS;
  address: { currentAddress: string; city: string; province: string; zipCode: string };
  coordinates: { latitude: number; longitude: number };
  products: { name: string; brand?: string; price: number; quantityOnHand: number }[];
};

const STORE_SPECS: StoreSpec[] = [
  {
    slug: 'highland-grocer-baguio',
    storeName: 'Highland Grocer',
    description: 'Fresh Cordillera produce, dairy and pantry staples.',
    categoryName: 'Food & Beverage',
    approvalStatus: STOREAPPROVALSTATUS.ACTIVE,
    address: {
      currentAddress: '18 Naguilian Road',
      city: 'Baguio City',
      province: 'Benguet',
      zipCode: '2600',
    },
    coordinates: { latitude: 16.4023, longitude: 120.5875 },
    products: [
      {
        name: 'Benguet Strawberries (500g)',
        brand: 'La Trinidad Farms',
        price: 220,
        quantityOnHand: 40,
      },
      {
        name: 'Highland Broccoli (1kg)',
        brand: 'La Trinidad Farms',
        price: 180,
        quantityOnHand: 65,
      },
      {
        name: 'Cordillera Arabica Beans (250g)',
        brand: 'Sagada Roasters',
        price: 480,
        quantityOnHand: 30,
      },
      { name: 'Fresh Carabao Milk (1L)', brand: 'Benguet Dairy', price: 150, quantityOnHand: 25 },
    ],
  },
  {
    slug: 'session-road-electronics',
    storeName: 'Session Road Electronics',
    description: 'Consumer electronics, accessories and small appliance repair.',
    categoryName: 'Electronics',
    approvalStatus: STOREAPPROVALSTATUS.ACTIVE,
    address: {
      currentAddress: '92 Session Road',
      city: 'Baguio City',
      province: 'Benguet',
      zipCode: '2600',
    },
    coordinates: { latitude: 16.4118, longitude: 120.5964 },
    products: [
      { name: 'USB-C Fast Charger 65W', brand: 'Voltix', price: 1250, quantityOnHand: 50 },
      { name: 'Wireless Earbuds Pro', brand: 'Voltix', price: 2890, quantityOnHand: 18 },
      { name: 'Braided HDMI Cable 2m', brand: 'LinkPro', price: 640, quantityOnHand: 75 },
    ],
  },
  {
    slug: 'mines-view-pet-supply',
    storeName: 'Mines View Pet Supply',
    description: 'Pet food, grooming and accessories for highland climates.',
    categoryName: 'Pets',
    approvalStatus: STOREAPPROVALSTATUS.ACTIVE,
    address: {
      currentAddress: '4 Gibraltar Road',
      city: 'Baguio City',
      province: 'Benguet',
      zipCode: '2600',
    },
    coordinates: { latitude: 16.4152, longitude: 120.6265 },
    products: [
      { name: 'Adult Dog Kibble (5kg)', brand: 'Sierra Pet', price: 1180, quantityOnHand: 22 },
      { name: 'Cat Litter Clumping (10L)', brand: 'PurrFresh', price: 520, quantityOnHand: 34 },
      { name: 'Wool Pet Sweater (Medium)', brand: 'Baguio Knits', price: 390, quantityOnHand: 12 },
    ],
  },
  {
    // The fixture's reason for existing: awaiting approval, and empty.
    slug: 'camp-john-hay-outfitters',
    storeName: 'Camp John Hay Outfitters',
    description: 'Trail and camping gear. Application submitted, awaiting review.',
    categoryName: 'Sports & Outdoors',
    approvalStatus: STOREAPPROVALSTATUS.PENDING,
    address: {
      currentAddress: 'Loakan Road, Camp John Hay',
      city: 'Baguio City',
      province: 'Benguet',
      zipCode: '2600',
    },
    coordinates: { latitude: 16.3906, longitude: 120.6151 },
    products: [],
  },
];

export async function seedMultiStoreSeller(prisma: PrismaClient) {
  console.log('🌱 Seeding multi-store seller scenario...');

  // ── 1. Seller user ────────────────────────────────────────────────────────
  // Created by users.seeder.ts, which seed.ts always runs first — this seeder
  // only attaches the multi-store scenario to that existing user, it does not
  // own the account.
  const user = await prisma.users.findUnique({ where: { email: SELLER_EMAIL } });
  if (!user) {
    throw new Error(
      `seedMultiStoreSeller: no user found for ${SELLER_EMAIL}. ` +
        'seedUsers(prisma) must run before seedMultiStoreSeller(prisma) — it owns creating this account.',
    );
  }

  // ── 2. Seller profile ─────────────────────────────────────────────────────
  // Approved at the seller level on purpose: the pending state under test is the
  // fourth *store*, not the seller's application. Leaving the seller PENDING
  // would block every store and hide the case this fixture exists for.
  const seller = await prisma.sellers.upsert({
    where: { userId: user.id },
    update: { applicationStatus: ApplicationStatus.APPROVED, isOnboarded: true },
    create: {
      userId: user.id,
      applicationStatus: ApplicationStatus.APPROVED,
      isOnboarded: true,
      onboardedAt: new Date(),
      onboardingStep: 99,
      sellerPlan: 'STANDARD',
    },
  });

  // ── 3. Stores ─────────────────────────────────────────────────────────────
  for (const spec of STORE_SPECS) {
    const category = await prisma.categories.findFirst({
      where: { name: spec.categoryName, parentId: null },
    });

    if (!category) {
      console.log(`  ⚠️  Category "${spec.categoryName}" not found — run categories.seeder first.`);
    }

    const isApproved = spec.approvalStatus === STOREAPPROVALSTATUS.ACTIVE;

    const store = await prisma.stores.upsert({
      where: { slug: spec.slug },
      update: {
        storeName: spec.storeName,
        description: spec.description,
        approvalStatus: spec.approvalStatus,
        isActive: isApproved,
        primaryCategoryId: category?.id ?? null,
      },
      create: {
        sellerId: seller.id,
        slug: spec.slug,
        storeName: spec.storeName,
        description: spec.description,
        email: SELLER_EMAIL,
        phone: '+639171234567',
        approvalStatus: spec.approvalStatus,
        isActive: isApproved,
        // A pending store has never been reviewed, so it carries no reviewedAt.
        reviewedAt: isApproved ? new Date() : null,
        primaryCategoryId: category?.id ?? null,
      },
    });

    await prisma.storeLocations.upsert({
      where: { storeId: store.id },
      update: {},
      create: {
        storeId: store.id,
        currentAddress: spec.address.currentAddress,
        homeAddress: spec.address.currentAddress,
        city: spec.address.city,
        province: spec.address.province,
        zipCode: spec.address.zipCode,
        country: 'Philippines',
        latitude: spec.coordinates.latitude,
        longitude: spec.coordinates.longitude,
      },
    });

    for (const hours of WEEKLY_HOURS) {
      await prisma.storeHours.upsert({
        where: { storeId_dayOfWeek: { storeId: store.id, dayOfWeek: hours.dayOfWeek } },
        update: {},
        create: { storeId: store.id, ...hours },
      });
    }

    // Only stock a store that has nothing yet. Products have no natural unique
    // key, so re-running must not delete rows an order or cart may reference.
    const existingProductCount = await prisma.products.count({ where: { storeId: store.id } });

    if (spec.products.length === 0) {
      console.log(`  ✅ ${spec.storeName} — ${spec.approvalStatus}, no products (intentional)`);
      continue;
    }

    if (existingProductCount > 0) {
      console.log(
        `  ℹ️  ${spec.storeName} — already has ${existingProductCount} product(s), leaving as is`,
      );
      continue;
    }

    for (const p of spec.products) {
      const product = await prisma.products.create({
        data: {
          storeId: store.id,
          categoryId: category?.id ?? null,
          name: p.name,
          brand: p.brand,
          description: `${p.name} available at ${spec.storeName}.`,
          price: p.price,
          isActive: true,
          listedAt: new Date(),
        },
      });

      await prisma.inventory.create({
        data: {
          storeId: store.id,
          productId: product.id,
          quantityOnHand: p.quantityOnHand,
          quantityReserved: 0,
        },
      });
    }

    console.log(
      `  ✅ ${spec.storeName} — ${spec.approvalStatus}, ${spec.products.length} products`,
    );
  }

  console.log(`✅ Multi-store seller seeded. Sign in as ${SELLER_EMAIL} / ${SELLER_PASSWORD}`);
}
