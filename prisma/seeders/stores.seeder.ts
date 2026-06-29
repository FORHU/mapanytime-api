import { PrismaClient } from '@prisma/client';

export async function seedStores(prisma: PrismaClient) {
  console.log('🌱 Clearing old stores for massive 50k re-seed...');
  await prisma.storeLocations.deleteMany();
  await prisma.products.deleteMany();
  await prisma.stores.deleteMany();
  await prisma.sellers.deleteMany();

  console.log('🌱 Seeding 50,000 Stores & Products across Luzon...');

  const users = await prisma.users.findMany({
    where: {
      roles: {
        some: {
          roleName: 'SELLER',
        },
      },
    },
    select: { id: true },
  });
  console.log(`Found ${users.length} sellers...`);

  const BATCH_SIZE = 5000;

  // Create 500 dummy users for the dummy stores
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
    description: `Dummy store ${i} for Mapbox rendering stress test.`,
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

  // Bulk create Locations (Scattered around 3 major areas)
  const targetCities = [
    // Tight cluster right at Burnham Park so stores appear without panning.
    { name: 'Burnham Park, Baguio', lat: 16.4108, lng: 120.5934, radius: 0.015 },
    { name: 'Baguio City', lat: 16.4119, lng: 120.5933, radius: 0.04 },
    { name: 'Candon City', lat: 17.1958, lng: 120.4489, radius: 0.03 },
    { name: 'Metro Manila (NCR)', lat: 14.5995, lng: 120.9842, radius: 0.1 },
  ];

  for (let i = 0; i < stores.length; i += BATCH_SIZE) {
    const storeBatch = stores.slice(i, i + BATCH_SIZE);
    const locationData = storeBatch.map((s) => {
      // Pick a random target city
      const city = targetCities[Math.floor(Math.random() * targetCities.length)];

      // Scatter randomly within the city's radius
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
}
