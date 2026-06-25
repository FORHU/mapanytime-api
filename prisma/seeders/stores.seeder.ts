import { PrismaClient } from '@prisma/client';

export async function seedStores(prisma: PrismaClient) {
  console.log('🌱 Clearing old stores for massive 50k re-seed...');
  await prisma.storeLocations.deleteMany();
  await prisma.products.deleteMany();
  await prisma.stores.deleteMany();
  await prisma.sellers.deleteMany();

  console.log('🌱 Seeding 50,000 Stores & Products across Luzon...');

  const users = await prisma.users.findMany({
    where: { role: 'SELLER' },
    select: { id: true }
  });
  console.log(`Found ${users.length} sellers...`);

  const BATCH_SIZE = 5000;
  
  // Bulk create Sellers in batches
  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const userBatch = users.slice(i, i + BATCH_SIZE);
    await prisma.sellers.createMany({
      data: userBatch.map(u => ({ userId: u.id })),
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

  // Bulk create Locations (Scattered across Luzon)
  for (let i = 0; i < stores.length; i += BATCH_SIZE) {
    const storeBatch = stores.slice(i, i + BATCH_SIZE);
    const locationData = storeBatch.map((s) => {
      // Luzon bounding box approx:
      // Lat: 13.0 to 18.5
      // Lng: 119.5 to 124.0
      const lat = 13.0 + Math.random() * (18.5 - 13.0);
      const lng = 119.5 + Math.random() * (124.0 - 119.5);
      
      return {
        storeId: s.id,
        currentAddress: `Luzon Highway`,
        homeAddress: `Luzon Highway`,
        city: 'Various',
        province: 'Luzon Region',
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
