import { PrismaClient } from '@prisma/client';

export async function seedStores(prisma: PrismaClient) {
  console.log('🌱 Seeding Stores & Products...');

  // Fetch the dummy seller created in users.seeder.ts
  const sellerUser = await prisma.users.findUnique({
    where: { Email: 'seller@example.com' }
  });

  if (!sellerUser) {
    console.log('❌ Seller user not found. Skipping store creation.');
    return;
  }

  // Create the Sellers profile
  const sellerProfile = await prisma.sellers.upsert({
    where: { UserId: sellerUser.Id },
    update: {},
    create: { UserId: sellerUser.Id }
  });
  console.log(`✅ Seller profile verified for: ${sellerUser.Email}`);

  // Create the Store
  const store = await prisma.stores.upsert({
    where: { SellerId: sellerProfile.Id },
    update: {},
    create: {
      SellerId: sellerProfile.Id,
      StoreName: "Premium Tech",
      Description: "High quality electronics and accessories.",
      IsActive: true,
    }
  });
  console.log(`✅ Store created: ${store.StoreName}`);

  // Create dummy Products
  const products = [
    { Name: 'Wireless Ergonomic Mouse', Price: 1350.00, Brand: 'LogiTech', Category: 'Electronics', Description: 'Comfortable wireless mouse for long working hours.' },
    { Name: 'Mechanical Keyboard (Red Switches)', Price: 1500.00, Brand: 'Keychron', Category: 'Electronics', Description: 'Hot-swappable mechanical keyboard.' },
    { Name: '100W USB-C Charger', Price: 500.00, Brand: 'Anker', Category: 'Accessories', Description: 'Fast charging brick for laptops and phones.' }
  ];

  for (const prod of products) {
    const existingProduct = await prisma.products.findFirst({
      where: { StoreId: store.Id, Name: prod.Name }
    });

    if (!existingProduct) {
      await prisma.products.create({
        data: {
          ...prod,
          StoreId: store.Id,
          IsActive: true,
        }
      });
      console.log(`✅ Created product: ${prod.Name}`);
    }
  }
}