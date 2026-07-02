import { PrismaClient } from '@prisma/client';

export async function seedStores(prisma: PrismaClient) {
  console.log('🌱 Clearing old stores for massive re-seed...');
  await prisma.tags.deleteMany();
  await prisma.products.deleteMany();
  await prisma.documents.deleteMany();
  await prisma.documentVerifications.deleteMany();
  await prisma.storeLocations.deleteMany();
  await prisma.stores.deleteMany();
  await prisma.sellers.deleteMany();

  const BATCH_SIZE = 5000;

  // Left at 500 for now to prevent local crashing.
  const TOTAL_STORES = 500;
  console.log(`🌱 Generating ${TOTAL_STORES} dummy Users, Sellers, and Stores...`);

  const dummyUsers = Array.from({ length: TOTAL_STORES }).map((_, i) => ({
    email: `dummy_seller_${i}@example.com`,
    passwordHash: 'dummy',
    firstName: `Dummy ${i}`,
    lastName: 'Seller',
    isEmailVerified: true,
  }));

  for (let i = 0; i < dummyUsers.length; i += BATCH_SIZE) {
    const batch = dummyUsers.slice(i, i + BATCH_SIZE);
    await prisma.users.createMany({ data: batch, skipDuplicates: true });
  }

  const allDummyUsers = await prisma.users.findMany({
    where: { email: { startsWith: 'dummy_seller_' } },
  });

  const dummySellers = allDummyUsers.map((u) => ({
    userId: u.id,
  }));

  for (let i = 0; i < dummySellers.length; i += BATCH_SIZE) {
    const batch = dummySellers.slice(i, i + BATCH_SIZE);
    await prisma.sellers.createMany({ data: batch, skipDuplicates: true });
  }

  const allDummySellers = await prisma.sellers.findMany({
    where: { userId: { in: allDummyUsers.map((u) => u.id) } },
  });

  const newStores = allDummySellers.map((seller, i) => ({
    sellerId: seller.id,
    storeName: `Luzon Route Merchant ${i}`,
    description: `Dummy store ${i} for rendering stress test.`,
    isActive: true,
  }));

  for (let i = 0; i < newStores.length; i += BATCH_SIZE) {
    const storeBatch = newStores.slice(i, i + BATCH_SIZE);
    await prisma.stores.createMany({
      data: storeBatch,
      skipDuplicates: true,
    });
  }
  const stores = await prisma.stores.findMany();

  // Bulk create Locations
  const targetCities = [
    { name: 'Burnham Park, Baguio', lat: 16.4108, lng: 120.5934, radius: 0.015 },
    { name: 'Baguio City', lat: 16.4119, lng: 120.5933, radius: 0.04 },
    { name: 'Candon City', lat: 17.1958, lng: 120.4489, radius: 0.03 },
    { name: 'Metro Manila (NCR)', lat: 14.5995, lng: 120.9842, radius: 0.1 },
  ];

  for (let i = 0; i < stores.length; i += BATCH_SIZE) {
    const storeBatch = stores.slice(i, i + BATCH_SIZE);
    const locationData = storeBatch.map((s) => {
      const city = targetCities[Math.floor(Math.random() * targetCities.length)];
      const latOffset = (Math.random() * 2 - 1) * city.radius;
      const lngOffset = (Math.random() * 2 - 1) * city.radius;

      const lat = city.lat + latOffset;
      const lng = city.lng + lngOffset;

      return {
        storeId: s.id,
        currentAddress: `${city.name} Commercial Road`,
        homeAddress: `${city.name} Commercial Road`,
        city: city.name,
        province:
          city.name === 'Metro Manila (NCR)'
            ? 'NCR'
            : city.name.includes('Baguio')
              ? 'Benguet'
              : 'Ilocos Sur',
        zipCode: '1000',
        country: 'Philippines',
        latitude: lat,
        longitude: lng,
      };
    });

    await prisma.storeLocations.createMany({
      data: locationData,
      skipDuplicates: true,
    });
  }

  console.log(`✅ ${stores.length} Stores successfully safely rendered into database!`);

  // --- ADDED: MEMORY-SAFE PRODUCT SEEDING ---
  console.log('🌱 Fetching global sub-categories for products...');
  // Fetch only categories that have a parent (meaning they are product sub-categories)
  const subCategories = await prisma.categories.findMany({
    where: { parentId: { not: null } },
  });

  if (subCategories.length === 0) {
    throw new Error('No sub-categories found. Ensure seedCategories runs first.');
  }

  // Map each sub-category to its parent so a store can be tagged with the
  // PARENT categories of the products it sells (the map filters by parent and
  // expands to descendants server-side).
  const subToParent = new Map<string, string>();
  for (const c of subCategories) {
    if (c.parentId) subToParent.set(c.id, c.parentId);
  }

  console.log('🌱 Seeding 50-100 Products for each store...');
  const PRODUCT_CHUNK_LIMIT = 5000;
  let productPayload = [];

  // Collected after products are generated: which parent categories each store
  // ends up covering, so we can populate the Store↔Category M2M.
  const storeCategoryLinks: { storeId: string; parentIds: string[] }[] = [];

  for (const store of stores) {
    const productCount = Math.floor(Math.random() * 51) + 50;
    const storeParentIds = new Set<string>();

    for (let p = 0; p < productCount; p++) {
      // Randomly assign one of the global sub-categories
      const randomCategory = subCategories[Math.floor(Math.random() * subCategories.length)];

      const parentId = subToParent.get(randomCategory.id);
      if (parentId) storeParentIds.add(parentId);

      productPayload.push({
        storeId: store.id,
        categoryId: randomCategory.id, // Updated to use the global category ID
        name: `Automated Item ${p + 1} - ${store.storeName}`,
        description: 'Standard product generated for load testing.',
        price: Math.floor(Math.random() * 5000) + 100,
      });
    }

    storeCategoryLinks.push({ storeId: store.id, parentIds: [...storeParentIds] });

    // Flushes to the database before the array consumes too much RAM
    if (productPayload.length >= PRODUCT_CHUNK_LIMIT) {
      await prisma.products.createMany({
        data: productPayload,
        skipDuplicates: true,
      });
      productPayload = [];
    }
  }

  // Inserts any remaining products left in the payload array
  if (productPayload.length > 0) {
    await prisma.products.createMany({
      data: productPayload,
      skipDuplicates: true,
    });
  }
  console.log('✅ Products and Categories successfully seeded!');

  // --- Link stores to the parent categories of their products (M2M) ---
  console.log('🌱 Linking stores to their product categories...');
  for (const link of storeCategoryLinks) {
    if (link.parentIds.length === 0) continue;
    await prisma.stores.update({
      where: { id: link.storeId },
      data: { categories: { connect: link.parentIds.map((id) => ({ id })) } },
    });
  }
  console.log('✅ Store categories linked!');

  // --- AUTOMATED VERIFICATION FOR TEST ACCOUNTS ---
  console.log('🌱 Automating verification for test accounts...');
  const testEmails = ['seller@example.com', 'dual@example.com'];

  for (const email of testEmails) {
    const user = await prisma.users.findUnique({ where: { email } });
    if (user) {
      await prisma.sellers.updateMany({
        where: { userId: user.id },
        data: { applicationStatus: 'APPROVED' },
      });

      const store = await prisma.stores.findFirst({
        where: { seller: { userId: user.id } },
      });

      if (store) {
        await prisma.documentVerifications.create({
          data: {
            storeId: store.id,
            sellerId: store.sellerId,
            verificationStatus: 'APPROVED',
          },
        });
        console.log(`✅ Verified store for: ${email}`);
      }
    }
  }
}
