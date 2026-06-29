import { PrismaClient } from '@prisma/client';

export async function seedStores(prisma: PrismaClient) {
  console.log('🌱 Clearing old stores for massive 50k re-seed...');
  await prisma.tags.deleteMany();
  await prisma.documents.deleteMany();
  await prisma.documentVerifications.deleteMany();
  await prisma.products.deleteMany();
  await prisma.categories.deleteMany();
  await prisma.storeLocations.deleteMany();
  await prisma.stores.deleteMany();
  await prisma.sellers.deleteMany();

  console.log('🌱 Seeding 50,000 Stores & Products across Luzon...');

  const users = await prisma.users.findMany({
    where: { roles: { some: { roleName: 'SELLER' } } },
    select: { id: true, email: true },
  });

  const BATCH_SIZE = 5000;
  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const userBatch = users.slice(i, i + BATCH_SIZE);
    await prisma.sellers.createMany({
      data: userBatch.map((u) => ({ userId: u.id })),
      skipDuplicates: true,
    });
  }
  const sellers = await prisma.sellers.findMany();

  // Bulk create Stores in batches
  for (let i = 0; i < sellers.length; i += BATCH_SIZE) {
    const sellerBatch = sellers.slice(i, i + BATCH_SIZE);
    await prisma.stores.createMany({
      data: sellerBatch.map((s, index) => ({
        sellerId: s.id,
        storeName: `Luzon Route Merchant ${i + index}`,
        description: `Dummy store ${i + index} for Mapbox rendering stress test.`,
        isActive: true,
      })),
      skipDuplicates: true,
    });
  }
  const stores = await prisma.stores.findMany();

  // Bulk create Locations (Scattered around 3 major areas)
  const targetCities = [
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
            : city.name === 'Baguio City'
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
