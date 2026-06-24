import { PrismaClient } from '@prisma/client';

export async function seedStores(prisma: PrismaClient) {
  console.log('🌱 Seeding Stores & Products...');

  // Fetch the dummy seller created in users.seeder.ts
  const sellerUser = await prisma.users.findUnique({
    where: { email: 'seller@example.com' }
  });

  if (!sellerUser) {
    console.log('❌ Seller user not found. Skipping store creation.');
    return;
  }

  // Create the Sellers profile
  const sellerProfile = await prisma.sellers.upsert({
    where: { userId: sellerUser.id},
    update: {},
    create: { userId: sellerUser.id }
  });
  console.log(`✅ Seller profile verified for: ${sellerUser.email}`);

  // Create the Store
  const store = await prisma.stores.upsert({
    where: { sellerId: sellerProfile.id },
    update: {},
    create: {
      sellerId: sellerProfile.id,
      storeName: "Premium Tech",
      description: "High quality electronics and accessories.",
      isActive: true,
    }
  });
  console.log(`✅ Store created: ${store.storeName}`);

  // Create dummy Products
  const products = [
    { name: 'Wireless Ergonomic Mouse', price: 1350.00, brand: 'LogiTech', category: 'Electronics', description: 'Comfortable wireless mouse for long working hours.' },
    { name: 'Mechanical Keyboard (Red Switches)', price: 1500.00, brand: 'Keychron', category: 'Electronics', description: 'Hot-swappable mechanical keyboard.' },
    { name: '100W USB-C Charger', price: 500.00, brand: 'Anker', category: 'Accessories', description: 'Fast charging brick for laptops and phones.' }
  ];

  for (const prod of products) {
    const existingProduct = await prisma.products.findFirst({
      where: { storeId: store.id, name: prod.name }
    });

    if (!existingProduct) {
      await prisma.products.create({
        data: {
          ...prod,
          storeId: store.id,
          isActive: true,
        }
      });
      console.log(`✅ Created product: ${prod.name}`);
    }
  }
}