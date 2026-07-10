import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

/**
 * Legit, hand-authored test data: 10 real-feeling stores with realistic
 * products, inventory, locations and approved seller/document verification —
 * enough to exercise the full map → products → cart → order → payment flow.
 *
 * Not for load testing. If you need thousands of dummy rows, write a separate
 * throwaway script; keep this file readable and true-to-life.
 */

function hashPassword(raw: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(raw, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

interface SeedProduct {
  name: string;
  brand?: string;
  price: number;
  /** Must match a sub-category name from categories.seeder.ts. */
  category: string;
  /** quantityOnHand for the inventory ledger. */
  stock: number;
}

interface SeedLocation {
  address: string;
  city: string;
  province: string;
  zipCode: string;
  latitude: number;
  longitude: number;
}

interface SeedStore {
  storeName: string;
  description: string;
  /** Reuse an existing seeded account, or a fresh dedicated seller. */
  ownerEmail: string;
  ownerFirstName: string;
  ownerLastName: string;
  location: SeedLocation;
  products: SeedProduct[];
}

// Every store clusters inside Baguio, anchored on three landmarks so they
// render tightly on the map: Baguio City Public Market (~16.4157, 120.5960),
// Burnham Park (~16.4108, 120.5934) and Legarda Road (~16.4085, 120.5980).
const STORES: SeedStore[] = [
  {
    storeName: 'Baguio Fresh Market',
    description: 'Farm-fresh highland produce, fruits and everyday grocery staples.',
    ownerEmail: 'seller@example.com', // existing test seller — now owns a real store
    ownerFirstName: 'Grace',
    ownerLastName: 'Piatos',
    location: {
      address: 'Baguio City Public Market, Magsaysay Ave',
      city: 'Baguio City',
      province: 'Benguet',
      zipCode: '2600',
      latitude: 16.4157,
      longitude: 120.596,
    },
    products: [
      { name: 'Fresh Strawberries (1kg)', price: 250, category: 'Fruits', stock: 40 },
      { name: 'Highland Broccoli (500g)', price: 80, category: 'Vegetables', stock: 60 },
      { name: 'Baguio Lettuce (per head)', price: 45, category: 'Vegetables', stock: 80 },
      { name: 'Sweet Corn (3 pcs)', price: 60, category: 'Vegetables', stock: 50 },
      { name: 'Ripe Mangoes (1kg)', price: 180, category: 'Fruits', stock: 45 },
      { name: 'Free-Range Eggs (dozen)', price: 110, category: 'Dairy', stock: 70 },
      { name: 'Fresh Carrots (1kg)', price: 90, category: 'Vegetables', stock: 55 },
      {
        name: 'Benguet Coffee Beans (250g)',
        brand: 'Cordillera',
        price: 320,
        category: 'Beverages',
        stock: 30,
      },
    ],
  },
  {
    storeName: 'Session Brews Cafe',
    description: 'Cozy Session Road cafe serving specialty coffee and fresh-baked pastries.',
    ownerEmail: 'dual@example.com', // existing dual buyer/seller account
    ownerFirstName: 'Alex',
    ownerLastName: 'Mercer',
    location: {
      address: '2F Session Road, Baguio City',
      city: 'Baguio City',
      province: 'Benguet',
      zipCode: '2600',
      latitude: 16.4118,
      longitude: 120.5952,
    },
    products: [
      { name: 'Cafe Latte', price: 140, category: 'Cafe', stock: 100 },
      { name: 'Cappuccino', price: 150, category: 'Cafe', stock: 100 },
      { name: 'Iced Caramel Macchiato', price: 165, category: 'Beverages', stock: 80 },
      { name: 'Hot Chocolate', price: 120, category: 'Beverages', stock: 60 },
      { name: 'Ube Cheese Pandesal (6 pcs)', price: 90, category: 'Bakery', stock: 40 },
      { name: 'Cinnamon Roll', price: 75, category: 'Bakery', stock: 35 },
      { name: 'Blueberry Muffin', price: 85, category: 'Bakery', stock: 30 },
    ],
  },
  {
    storeName: 'Highland Meats & Seafood',
    description: 'Fresh-cut meats and daily-caught seafood from the highlands and coast.',
    ownerEmail: 'seller.meats@mapanytime.test',
    ownerFirstName: 'Ramon',
    ownerLastName: 'Delos Santos',
    location: {
      address: 'Hangar Market, Baguio City',
      city: 'Baguio City',
      province: 'Benguet',
      zipCode: '2600',
      latitude: 16.415,
      longitude: 120.5955,
    },
    products: [
      { name: 'Fresh Pork Belly (1kg)', price: 380, category: 'Meat', stock: 30 },
      { name: 'Beef Sirloin (1kg)', price: 520, category: 'Meat', stock: 20 },
      { name: 'Whole Chicken (1kg)', price: 210, category: 'Meat', stock: 40 },
      { name: 'Pork Ribs (1kg)', price: 360, category: 'Meat', stock: 22 },
      { name: 'Bangus / Milkfish (1kg)', price: 200, category: 'Seafood', stock: 35 },
      { name: 'Fresh Tilapia (1kg)', price: 160, category: 'Seafood', stock: 40 },
      { name: 'Fresh Shrimp (500g)', price: 320, category: 'Seafood', stock: 25 },
    ],
  },
  {
    storeName: 'TechHub Baguio',
    description: 'Gadgets, computer peripherals and mobile accessories.',
    ownerEmail: 'seller.tech@mapanytime.test',
    ownerFirstName: 'Marco',
    ownerLastName: 'Villanueva',
    location: {
      address: 'Legarda Road, Baguio City',
      city: 'Baguio City',
      province: 'Benguet',
      zipCode: '2600',
      latitude: 16.4088,
      longitude: 120.5982,
    },
    products: [
      { name: 'Wireless Mouse', brand: 'Logitech', price: 850, category: 'Computers', stock: 40 },
      { name: 'Mechanical Keyboard', brand: 'Rakk', price: 2200, category: 'Computers', stock: 25 },
      { name: 'Laptop Stand (Aluminum)', price: 990, category: 'Computers', stock: 30 },
      {
        name: 'USB-C Fast Charger 30W',
        brand: 'Aukey',
        price: 690,
        category: 'Mobile Phones',
        stock: 60,
      },
      {
        name: 'Power Bank 20000mAh',
        brand: 'Anker',
        price: 1450,
        category: 'Mobile Phones',
        stock: 35,
      },
      { name: 'Gaming Headset', brand: 'HyperX', price: 3200, category: 'Gaming', stock: 18 },
      { name: '1080p Webcam', brand: 'Logitech', price: 1750, category: 'Cameras', stock: 20 },
    ],
  },
  {
    storeName: 'Cordillera Crafts & Gifts',
    description: 'Handwoven textiles, local souvenirs and artisan gifts.',
    ownerEmail: 'seller.crafts@mapanytime.test',
    ownerFirstName: 'Divina',
    ownerLastName: 'Baguilat',
    location: {
      address: 'Burnham Park, Baguio City',
      city: 'Baguio City',
      province: 'Benguet',
      zipCode: '2600',
      latitude: 16.4108,
      longitude: 120.5934,
    },
    products: [
      { name: 'Handwoven Inabel Scarf', price: 450, category: 'Arts & Crafts', stock: 25 },
      { name: 'Miniature Bahay Kubo', price: 350, category: 'Arts & Crafts', stock: 15 },
      { name: 'Wooden Baguio Keychain', price: 60, category: 'Gifts', stock: 100 },
      { name: 'Ceramic Coffee Mug', price: 190, category: 'Gifts', stock: 45 },
      { name: 'Beaded Bracelet', price: 120, category: 'Accessories', stock: 60 },
      { name: 'Rattan Woven Bag', price: 780, category: 'Bags', stock: 20 },
    ],
  },
  {
    storeName: 'Legarda Fashion Hub',
    description: 'Trendy apparel, footwear and accessories at outlet prices.',
    ownerEmail: 'seller.fashion@mapanytime.test',
    ownerFirstName: 'Bea',
    ownerLastName: 'Reyes',
    location: {
      address: 'Legarda Road, Baguio City',
      city: 'Baguio City',
      province: 'Benguet',
      zipCode: '2600',
      latitude: 16.4083,
      longitude: 120.5978,
    },
    products: [
      { name: 'Cotton Graphic Tee', price: 399, category: 'Fashion', stock: 80 },
      { name: 'Slim-Fit Denim Jeans', price: 899, category: 'Fashion', stock: 50 },
      { name: 'Hooded Sweatshirt', price: 1099, category: 'Fashion', stock: 30 },
      { name: 'Canvas Sneakers', price: 1299, category: 'Shoes', stock: 40 },
      { name: 'Leather Belt', price: 450, category: 'Accessories', stock: 60 },
      { name: 'Crossbody Sling Bag', price: 750, category: 'Bags', stock: 35 },
    ],
  },
  {
    storeName: 'HomeStyle Furnishings',
    description: 'Furniture, kitchenware and home essentials for modern living.',
    ownerEmail: 'seller.home@mapanytime.test',
    ownerFirstName: 'Joel',
    ownerLastName: 'Cruz',
    location: {
      address: 'Lower Legarda Road, Baguio City',
      city: 'Baguio City',
      province: 'Benguet',
      zipCode: '2600',
      latitude: 16.4079,
      longitude: 120.597,
    },
    products: [
      { name: '2-Seater Fabric Sofa', price: 12500, category: 'Furniture', stock: 6 },
      { name: 'Wooden Coffee Table', price: 4200, category: 'Furniture', stock: 10 },
      { name: 'Ceramic Dinner Set (16 pc)', price: 1850, category: 'Kitchen', stock: 20 },
      { name: 'Non-Stick Frying Pan', price: 850, category: 'Kitchen', stock: 35 },
      { name: 'Cotton Bed Sheet Set (Queen)', price: 1200, category: 'Bedding', stock: 25 },
      { name: 'LED Desk Lamp', price: 690, category: 'Home Decor', stock: 40 },
    ],
  },
  {
    storeName: 'WellCare Pharmacy',
    description: 'Trusted medicines, supplements and everyday medical supplies.',
    ownerEmail: 'seller.pharma@mapanytime.test',
    ownerFirstName: 'Liza',
    ownerLastName: 'Fernandez',
    location: {
      address: 'Magsaysay Ave, Baguio City',
      city: 'Baguio City',
      province: 'Benguet',
      zipCode: '2600',
      latitude: 16.413,
      longitude: 120.5945,
    },
    products: [
      {
        name: 'Paracetamol 500mg (10 tabs)',
        brand: 'Biogesic',
        price: 45,
        category: 'Pharmacy',
        stock: 200,
      },
      {
        name: 'Alcohol 70% (500ml)',
        brand: 'Green Cross',
        price: 95,
        category: 'Pharmacy',
        stock: 150,
      },
      {
        name: 'Vitamin C 500mg (30 caps)',
        brand: 'Fern-C',
        price: 180,
        category: 'Supplements',
        stock: 120,
      },
      {
        name: 'Multivitamins (60 tabs)',
        brand: 'Centrum',
        price: 420,
        category: 'Supplements',
        stock: 80,
      },
      { name: 'Digital Thermometer', price: 250, category: 'Medical Supplies', stock: 60 },
      {
        name: 'Surgical Face Masks (50 pcs)',
        price: 150,
        category: 'Medical Supplies',
        stock: 100,
      },
    ],
  },
  {
    storeName: 'PetPals Supplies',
    description: 'Food, grooming and accessories for your furry and feathered friends.',
    ownerEmail: 'seller.pets@mapanytime.test',
    ownerFirstName: 'Karla',
    ownerLastName: 'Domingo',
    location: {
      address: 'Harrison Road, near Burnham Park, Baguio City',
      city: 'Baguio City',
      province: 'Benguet',
      zipCode: '2600',
      latitude: 16.4095,
      longitude: 120.5952,
    },
    products: [
      { name: 'Dog Dry Food 3kg', brand: 'Pedigree', price: 620, category: 'Pet Shop', stock: 40 },
      { name: 'Cat Litter 5L', price: 350, category: 'Pet Shop', stock: 50 },
      { name: 'Chew Toy Bone', price: 150, category: 'Pet Shop', stock: 70 },
      { name: 'Stainless Pet Bowl', price: 190, category: 'Pet Shop', stock: 55 },
      { name: 'Bird Seed Mix 1kg', price: 130, category: 'Pet Shop', stock: 40 },
      { name: 'Pet Shampoo 500ml', price: 220, category: 'Pet Grooming', stock: 45 },
    ],
  },
  {
    storeName: 'ProGear Sports',
    description: 'Fitness gear, sporting goods and outdoor adventure equipment.',
    ownerEmail: 'seller.sports@mapanytime.test',
    ownerFirstName: 'Nico',
    ownerLastName: 'Tan',
    location: {
      address: 'Harrison Road, Burnham Park, Baguio City',
      city: 'Baguio City',
      province: 'Benguet',
      zipCode: '2600',
      latitude: 16.41,
      longitude: 120.5928,
    },
    products: [
      { name: 'Yoga Mat 6mm', price: 490, category: 'Sports', stock: 50 },
      { name: 'Dumbbell Set 10kg', price: 1350, category: 'Sports', stock: 20 },
      { name: 'Basketball Size 7', brand: 'Spalding', price: 780, category: 'Sports', stock: 30 },
      { name: '2-Person Camping Tent', price: 2800, category: 'Camping', stock: 12 },
      { name: 'Insulated Water Bottle 1L', price: 550, category: 'Outdoor', stock: 60 },
      { name: 'Trekking Backpack 40L', price: 1950, category: 'Outdoor', stock: 18 },
    ],
  },
];

export async function seedStores(prisma: PrismaClient) {
  console.log('🌱 Seeding 10 legit stores with realistic products...');

  // Clean slate for the marketplace data, in FK-safe order. Keeps users/roles
  // so existing test logins survive; seller profiles are re-approved below.
  await prisma.payments.deleteMany();
  await prisma.orderItems.deleteMany();
  await prisma.orders.deleteMany();
  await prisma.tags.deleteMany();
  await prisma.inventory.deleteMany();
  await prisma.products.deleteMany();
  await prisma.storeLocations.deleteMany();
  await prisma.documentVerifications.deleteMany();
  await prisma.stores.deleteMany();

  // Category lookup by name → resolve each product's sub-category and its parent
  // (the map filters by parent category and expands to descendants server-side).
  const categories = await prisma.categories.findMany();
  const catByName = new Map(categories.map((c) => [c.name, c]));

  // Ensure the known test buyers have a Buyers profile so they can place orders.
  for (const email of ['buyer@example.com', 'dual@example.com']) {
    const user = await prisma.users.findUnique({ where: { email } });
    if (!user) continue;
    const existing = await prisma.buyers.findUnique({ where: { userId: user.id } });
    if (!existing) {
      await prisma.buyers.create({
        data: {
          userId: user.id,
          displayName: `${user.firstName ?? 'Buyer'} ${user.lastName ?? ''}`.trim(),
        },
      });
      console.log(`✅ Buyer profile ready for: ${email}`);
    }
  }

  for (const s of STORES) {
    // Ensure the owning user exists (create dedicated sellers on the fly).
    let user = await prisma.users.findUnique({ where: { email: s.ownerEmail } });
    if (!user) {
      user = await prisma.users.create({
        data: {
          email: s.ownerEmail,
          passwordHash: hashPassword('Seller123'),
          firstName: s.ownerFirstName,
          lastName: s.ownerLastName,
          isEmailVerified: true,
          countryCode: 'PH',
          roles: { connect: [{ roleName: 'SELLER' }] },
        },
      });
    }

    // Ensure an APPROVED seller profile.
    const seller = await prisma.sellers.upsert({
      where: { userId: user.id },
      update: { applicationStatus: 'APPROVED' },
      create: { userId: user.id, applicationStatus: 'APPROVED' },
    });

    // Store + location.
    const store = await prisma.stores.create({
      data: {
        sellerId: seller.id,
        storeName: s.storeName,
        description: s.description,
        isActive: true,
        storeLocations: {
          create: {
            currentAddress: s.location.address,
            homeAddress: s.location.address,
            city: s.location.city,
            province: s.location.province,
            zipCode: s.location.zipCode,
            country: 'Philippines',
            latitude: s.location.latitude,
            longitude: s.location.longitude,
          },
        },
      },
    });

    // Approved document verification so seller-side actions pass ownership checks.
    await prisma.documentVerifications.create({
      data: {
        storeId: store.id,
        sellerId: seller.id,
        verificationStatus: 'APPROVED',
        verifiedById: null,
      },
    });

    // Products + inventory ledger (order flow reads product.inventory[0]).
    const parentIds = new Set<string>();
    for (const p of s.products) {
      const category = catByName.get(p.category);
      if (!category) {
        throw new Error(`Category "${p.category}" not found — run seedCategories first.`);
      }
      if (category.parentId) parentIds.add(category.parentId);

      await prisma.products.create({
        data: {
          storeId: store.id,
          categoryId: category.id,
          name: p.name,
          brand: p.brand ?? null,
          description: `${p.name} available at ${s.storeName}.`,
          price: p.price,
          isActive: true,
          listedAt: new Date(),
          inventory: {
            create: {
              storeId: store.id,
              quantityOnHand: p.stock,
              quantityReserved: 0,
            },
          },
        },
      });
    }

    // Link the store to the parent categories of the products it carries (M2M).
    if (parentIds.size > 0) {
      await prisma.stores.update({
        where: { id: store.id },
        data: { categories: { connect: [...parentIds].map((id) => ({ id })) } },
      });
    }

    console.log(`✅ ${s.storeName} — ${s.products.length} products (${s.location.city})`);
  }

  console.log('🎉 10 stores seeded with products, inventory and locations!');
}
