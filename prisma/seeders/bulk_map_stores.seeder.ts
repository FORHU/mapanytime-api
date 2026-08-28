import {
  PrismaClient,
  STOREAPPROVALSTATUS,
  PRODUCTSTATUS,
  ApplicationStatus,
} from '@prisma/client';
import crypto from 'crypto';

/**
 * Volume fixture for map-density testing: ~55 stores scattered across the
 * real Baguio City / La Trinidad area (matches the coordinate range the
 * hand-crafted stores in stores_and_products.seeder.ts already use), spread
 * across every top-level category, each carrying 20–50 products.
 *
 * Deliberately generated, not hand-authored per-item: at ~55 stores x up to
 * 50 products (up to ~2,750 rows), writing unique copy per product is not a
 * realistic use of time. Product variety comes from crossing a base-item
 * pool with size/pack variants per category. Everything is driven by a
 * seeded PRNG keyed on store index — not Math.random — so re-running the
 * seed is idempotent (same stores, same product counts, same picks) rather
 * than jittering on every run.
 *
 * Owned by 5 dedicated "bulk" sellers rather than piling onto the existing
 * hand-crafted sellers, so this fixture can be identified/removed as a block
 * later without touching the curated data.
 */

const BULK_SELLERS = [
  { email: 'bulk.seller1@mapanytime.test', firstName: 'Bulk', lastName: 'Seller One' },
  { email: 'bulk.seller2@mapanytime.test', firstName: 'Bulk', lastName: 'Seller Two' },
  { email: 'bulk.seller3@mapanytime.test', firstName: 'Bulk', lastName: 'Seller Three' },
  { email: 'bulk.seller4@mapanytime.test', firstName: 'Bulk', lastName: 'Seller Four' },
  { email: 'bulk.seller5@mapanytime.test', firstName: 'Bulk', lastName: 'Seller Five' },
];
const BULK_PASSWORD = 'Seller123';

/** Real Baguio City / La Trinidad barangays and roads, for plausible addresses. */
const NEIGHBORHOODS = [
  'Irisan',
  'Camp 7',
  'Camp 8',
  'Loakan',
  'Trancoville',
  'Pinsao Proper',
  'Asin Road',
  'Marcos Highway',
  'Kennon Road',
  'Naguilian Road',
  'Aurora Hill',
  'Quezon Hill',
  'Legarda',
  'Bakakeng',
  'Balacbac',
  'La Trinidad Poblacion',
  'Pico',
  'Tomay',
  'Betag',
  'Buyagan',
  'Km 5 Guisad',
  'Gibraltar',
  'Dominican Hill',
  'Military Cut-off',
  'Engineers Hill',
  'Upper Session',
  'Fairview Village',
  'Outlook Drive',
  'South Drive',
  'Rock Quarry',
];

/** Center roughly on Baguio City proper; La Trinidad sits just north. */
const CENTER = { lat: 16.4145, lng: 120.596 };

/** Deterministic pseudo-scatter — same output every run, no external RNG. */
function scatterOffset(index: number, spread: number): { dLat: number; dLng: number } {
  const angle = (index * 137.508 * Math.PI) / 180; // golden-angle spiral, even coverage
  const radius = spread * Math.sqrt((index % 37) / 37);
  return { dLat: radius * Math.cos(angle), dLng: radius * Math.sin(angle) };
}

/** mulberry32 — tiny seeded PRNG. Same seed always produces the same sequence. */
function makeRng(seed: number) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface BaseItem {
  name: string;
  brand: string;
  basePrice: number;
}

interface CategorySpec {
  categoryName: string;
  businessSuffixes: string[];
  baseItems: BaseItem[];
  /** e.g. sizes, pack counts, weights — appended to the base name to create variety. */
  variants: string[];
}

const CATEGORY_SPECS: CategorySpec[] = [
  {
    categoryName: 'Food & Beverage',
    businessSuffixes: ['Eatery', 'Grocery', 'Sari-Sari Store', 'Bakeshop', 'Carinderia'],
    variants: [
      '250g',
      '500g',
      '1kg',
      '2kg',
      'Pack of 6',
      'Pack of 12',
      'Family Size',
      'Single Serve',
    ],
    baseItems: [
      { name: 'Rice', brand: 'Local Miller', basePrice: 60 },
      { name: 'Instant Pancit Canton', brand: 'Lucky Me', basePrice: 15 },
      { name: 'Pandesal', brand: 'House Bake', basePrice: 6 },
      { name: 'Bottled Water', brand: 'Wilkins', basePrice: 25 },
      { name: 'Canned Corned Beef', brand: 'CDO', basePrice: 85 },
      { name: 'Coffee Refill', brand: 'Nescafe', basePrice: 90 },
      { name: 'Instant Noodles Cup', brand: 'Nissin', basePrice: 22 },
      { name: 'Cooking Oil', brand: 'Golden Fiesta', basePrice: 110 },
      { name: 'White Sugar', brand: 'Local Miller', basePrice: 70 },
      { name: 'Soy Sauce', brand: 'Silver Swan', basePrice: 35 },
      { name: 'Bread Loaf', brand: 'House Bake', basePrice: 65 },
      { name: 'Canned Sardines', brand: '555', basePrice: 28 },
    ],
  },
  {
    categoryName: 'Fashion & Cosmetics',
    businessSuffixes: ['Boutique', 'Fashion Shop', 'Trading', 'Variety Store', 'Gift Shop'],
    variants: ['Small', 'Medium', 'Large', 'Extra Large', 'One Size', 'Kids Size'],
    baseItems: [
      { name: 'Cotton Round Neck Shirt', brand: 'Local Wear', basePrice: 250 },
      { name: 'Canvas Tote Bag', brand: 'Handmade Co', basePrice: 320 },
      { name: 'Keychain Souvenir', brand: 'Craft Co', basePrice: 60 },
      { name: 'Denim Jeans', brand: 'Local Wear', basePrice: 850 },
      { name: 'Baseball Cap', brand: 'Local Wear', basePrice: 220 },
      { name: 'Knit Beanie', brand: 'Craft Co', basePrice: 180 },
      { name: 'Leather Wallet', brand: 'Handmade Co', basePrice: 480 },
      { name: 'Sunglasses', brand: 'Local Wear', basePrice: 350 },
      { name: 'Scarf', brand: 'Craft Co', basePrice: 290 },
      { name: 'Souvenir Fridge Magnet', brand: 'Craft Co', basePrice: 45 },
    ],
  },
  {
    categoryName: 'Electronics',
    businessSuffixes: ['Electronics', 'Gadget Shop', 'Phone Repair', 'Computer Shop'],
    variants: ['1m', '2m', '3m', '10000mAh', '20000mAh', 'Standard', 'Pro Edition'],
    baseItems: [
      { name: 'USB-C Cable', brand: 'GenTech', basePrice: 120 },
      { name: 'Power Bank', brand: 'Voltix', basePrice: 590 },
      { name: 'Phone Screen Protector', brand: 'GenTech', basePrice: 79 },
      { name: 'Wired Earphones', brand: 'SoundPro', basePrice: 150 },
      { name: 'Bluetooth Speaker', brand: 'SoundPro', basePrice: 890 },
      { name: 'Phone Case', brand: 'GenTech', basePrice: 180 },
      { name: 'Car Charger', brand: 'Voltix', basePrice: 220 },
      { name: 'HDMI Cable', brand: 'LinkPro', basePrice: 340 },
      { name: 'Wireless Mouse', brand: 'GenTech', basePrice: 380 },
    ],
  },
  {
    categoryName: 'Home & Living',
    businessSuffixes: ['Hardware', 'Home Depot', 'Furniture Shop', 'Paint Store'],
    variants: ['500g', '1kg', '4L', '16L', '9W', '18W', 'Small', 'Large'],
    baseItems: [
      { name: 'Assorted Nails', brand: 'Crown', basePrice: 90 },
      { name: 'Interior Paint', brand: 'Boysen', basePrice: 480 },
      { name: 'LED Bulb', brand: 'Philips', basePrice: 110 },
      { name: 'Plastic Storage Bin', brand: 'HomeBasics', basePrice: 280 },
      { name: 'PVC Pipe', brand: 'Crown Pipes', basePrice: 150 },
      { name: 'Extension Cord', brand: 'Omni', basePrice: 260 },
      { name: 'Door Hinge', brand: 'Crown', basePrice: 65 },
      { name: 'Garden Hose', brand: 'HomeBasics', basePrice: 420 },
      { name: 'Broom & Dustpan Set', brand: 'HomeBasics', basePrice: 190 },
    ],
  },
  {
    categoryName: 'Health & Wellness',
    businessSuffixes: ['Pharmacy', 'Drugstore', 'Wellness Center', 'Optical Clinic'],
    variants: [
      'Box of 20',
      'Box of 50',
      'Box of 100',
      'Bottle of 30',
      'Bottle of 60',
      '250ml',
      '500ml',
    ],
    baseItems: [
      { name: 'Paracetamol 500mg', brand: 'Biogesic', basePrice: 3 },
      { name: 'Multivitamins', brand: 'Enervon', basePrice: 5 },
      { name: 'Rubbing Alcohol', brand: 'Green Cross', basePrice: 65 },
      { name: 'Face Mask', brand: 'MedSafe', basePrice: 2 },
      { name: 'Cough Syrup', brand: 'Robitussin', basePrice: 145 },
      { name: 'Antiseptic Ointment', brand: 'Betadine', basePrice: 95 },
      { name: 'Vitamin C', brand: 'Poten-Cee', basePrice: 4 },
      { name: 'Hand Sanitizer', brand: 'Green Cross', basePrice: 75 },
    ],
  },
  {
    categoryName: 'Automotive',
    businessSuffixes: ['Auto Repair', 'Motor Parts', 'Vulcanizing Shop', 'Car Accessories'],
    variants: ['1L', '4L', 'Standard', 'Heavy Duty', 'Universal Fit'],
    baseItems: [
      { name: 'Motorcycle Engine Oil', brand: 'Motul', basePrice: 380 },
      { name: 'Tire Patch Kit', brand: 'AutoFix', basePrice: 140 },
      { name: 'Car Air Freshener', brand: 'AutoFix', basePrice: 85 },
      { name: 'Spark Plug', brand: 'NGK', basePrice: 165 },
      { name: 'Brake Fluid', brand: 'Motul', basePrice: 210 },
      { name: 'Car Wash Shampoo', brand: 'AutoFix', basePrice: 195 },
      { name: 'Windshield Wiper Blade', brand: 'Bosch', basePrice: 320 },
    ],
  },
  {
    categoryName: 'Pets',
    businessSuffixes: ['Pet Shop', 'Pet Grooming', 'Vet Clinic Supplies'],
    variants: ['1kg', '3kg', '5kg', '10kg', '250ml', 'Small', 'Large'],
    baseItems: [
      { name: 'Dog Food', brand: 'Pedigree', basePrice: 210 },
      { name: 'Cat Treats', brand: 'Whiskas', basePrice: 45 },
      { name: 'Pet Shampoo', brand: 'PetCare', basePrice: 200 },
      { name: 'Cat Litter', brand: 'PurrFresh', basePrice: 55 },
      { name: 'Pet Collar', brand: 'PetCare', basePrice: 160 },
      { name: 'Chew Toy', brand: 'PetCare', basePrice: 120 },
    ],
  },
  {
    categoryName: 'Sports & Outdoors',
    businessSuffixes: ['Sports Shop', 'Outdoor Gear', 'Bike Shop'],
    variants: ['Standard', 'Pro', 'Youth Size', '20L', '40L', '60L'],
    baseItems: [
      { name: 'Basketball', brand: 'Molten', basePrice: 850 },
      { name: 'Hiking Backpack', brand: 'TrailPro', basePrice: 650 },
      { name: 'Yoga Mat', brand: 'FlexFit', basePrice: 420 },
      { name: 'Camping Tent', brand: 'TrailPro', basePrice: 2200 },
      { name: 'Water Bottle', brand: 'FlexFit', basePrice: 280 },
      { name: 'Jump Rope', brand: 'FlexFit', basePrice: 150 },
    ],
  },
  {
    categoryName: 'Entertainment',
    businessSuffixes: ['Music Store', 'Bookshop', 'Hobby Shop', 'Game Store'],
    variants: ['Standard Edition', 'Deluxe Edition', 'A4', 'A5', 'Set of 6', 'Set of 12'],
    baseItems: [
      { name: 'Acoustic Guitar Strings', brand: "D'Addario", basePrice: 350 },
      { name: 'Board Game', brand: 'PlayCo', basePrice: 550 },
      { name: 'Sketchbook', brand: 'ArtBasics', basePrice: 95 },
      { name: 'Playing Cards', brand: 'PlayCo', basePrice: 65 },
      { name: 'Colored Pencils', brand: 'ArtBasics', basePrice: 180 },
      { name: 'Puzzle 500-Piece', brand: 'PlayCo', basePrice: 420 },
    ],
  },
  {
    categoryName: 'Baby & Kids',
    businessSuffixes: ['Baby Shop', 'Kids Store', 'Toy Store'],
    variants: ['Pack of 20', 'Pack of 30', 'Pack of 50', 'Small', 'Medium', 'Large'],
    baseItems: [
      { name: 'Baby Diapers', brand: 'Pampers', basePrice: 16 },
      { name: 'Infant Formula', brand: 'Nan', basePrice: 950 },
      { name: 'Building Blocks Set', brand: 'ToyCo', basePrice: 480 },
      { name: 'Baby Onesie', brand: 'LittleOnes', basePrice: 220 },
      { name: 'Baby Wipes', brand: 'Pampers', basePrice: 85 },
      { name: 'Stuffed Toy', brand: 'ToyCo', basePrice: 280 },
    ],
  },
  // NOTE: the former 'Services' CATEGORY_SPECS entry (Salon/Barbershop/Laundry/
  // Print Shop/Tailoring, generating fake "Haircut Service"/"Document Printing"
  // Products) was removed here rather than remapped — those are services, not
  // products, and the whole point of this taxonomy refactor is to stop filing
  // services as product-category rows. See the Service Entity Solution proposal
  // for where merchants like these belong once that model ships.
  {
    categoryName: 'Agriculture',
    businessSuffixes: ['Farm Supply', 'Agrivet', 'Seedling Nursery'],
    variants: ['Small Pack', '5kg', '10kg', '25kg', 'Assorted'],
    baseItems: [
      { name: 'Vegetable Seeds', brand: 'GreenGrow', basePrice: 40 },
      { name: 'Organic Fertilizer', brand: 'FarmPlus', basePrice: 220 },
      { name: 'Garden Trowel', brand: 'FarmTools', basePrice: 130 },
      { name: 'Pesticide Spray', brand: 'FarmPlus', basePrice: 260 },
      { name: 'Seedling Tray', brand: 'GreenGrow', basePrice: 90 },
    ],
  },
  {
    categoryName: 'Industrial & Business',
    businessSuffixes: ['Trading Co', 'Wholesale Supply', 'Industrial Parts'],
    variants: ['Pack of 12', 'Box of 50', 'Roll', 'Standard', 'Heavy Duty'],
    baseItems: [
      { name: 'Safety Gloves', brand: 'SafetyPro', basePrice: 32 },
      { name: 'Packing Tape', brand: 'PackRight', basePrice: 40 },
      { name: 'Industrial Bolts', brand: 'BoltCo', basePrice: 380 },
      { name: 'Safety Helmet', brand: 'SafetyPro', basePrice: 350 },
      { name: 'Cable Ties', brand: 'PackRight', basePrice: 60 },
    ],
  },
];

function seededOffsetLatLng(index: number) {
  const { dLat, dLng } = scatterOffset(index, 0.045);
  return { latitude: CENTER.lat + dLat, longitude: CENTER.lng + dLng };
}

// TODO: duplicated from users.seeder.ts (the copy in multi_store_seller.seeder.ts
// was just deleted in favor of a shared import) — reuse the same helper instead.
function hashPassword(raw: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(raw, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

const WEEKLY_HOURS = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
  dayOfWeek,
  openMinutes: 8 * 60,
  closeMinutes: 19 * 60,
  isClosed: dayOfWeek === 0,
}));

const STORES_PER_CATEGORY = 4; // 12 categories x 4 = 48 stores
const MIN_PRODUCTS = 20;
const MAX_PRODUCTS = 50;

/** All base×variant combinations for a category, e.g. "Rice (500g)". */
function buildProductPool(spec: CategorySpec): { name: string; brand: string; price: number }[] {
  const pool: { name: string; brand: string; price: number }[] = [];
  for (const base of spec.baseItems) {
    for (const variant of spec.variants) {
      pool.push({
        name: `${base.name} (${variant})`,
        brand: base.brand,
        price: base.basePrice,
      });
    }
  }
  return pool;
}

/** Fisher–Yates shuffle driven by the seeded rng, so picks are reproducible. */
function shuffled<T>(arr: T[], rng: () => number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export async function seedBulkMapStores(prisma: PrismaClient) {
  console.log('🌱 Seeding bulk map-density stores (20-50 products each)...');

  // ── 1. Bulk seller users ────────────────────────────────────────────────
  const sellerRecords = [];
  for (const spec of BULK_SELLERS) {
    let user = await prisma.users.findUnique({ where: { email: spec.email } });
    if (!user) {
      user = await prisma.users.create({
        data: {
          email: spec.email,
          firstName: spec.firstName,
          lastName: spec.lastName,
          passwordHash: hashPassword(BULK_PASSWORD),
          isEmailVerified: true,
          countryCode: 'PH',
          roles: { connect: [{ roleName: 'SELLER' }] },
        },
      });
    }

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
    sellerRecords.push(seller);
  }

  // ── 2. Category lookup ────────────────────────────────────────────────
  const categories = await prisma.categories.findMany({ where: { parentId: null } });
  const categoryMap = new Map(categories.map((c) => [c.name, c.id]));

  // ── 3. Generate & upsert stores + products ────────────────────────────
  let globalIndex = 0;
  let storeCount = 0;
  let productTotal = 0;

  for (const spec of CATEGORY_SPECS) {
    const categoryId = categoryMap.get(spec.categoryName);
    if (!categoryId) {
      console.log(`  ⚠️  Category "${spec.categoryName}" not found — skipping its bulk stores.`);
      continue;
    }

    const productPool = buildProductPool(spec);

    for (let i = 0; i < STORES_PER_CATEGORY; i++) {
      const neighborhood = NEIGHBORHOODS[globalIndex % NEIGHBORHOODS.length];
      const suffix = spec.businessSuffixes[i % spec.businessSuffixes.length];
      const storeName = `${neighborhood} ${suffix}`;
      const slug = `bulk-${storeName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')}-${globalIndex}`;
      const seller = sellerRecords[globalIndex % sellerRecords.length];
      const { latitude, longitude } = seededOffsetLatLng(globalIndex);
      const rng = makeRng(1000 + globalIndex);

      const store = await prisma.stores.upsert({
        where: { slug },
        update: {
          storeName,
          approvalStatus: STOREAPPROVALSTATUS.ACTIVE,
          isActive: true,
          primaryCategoryId: categoryId,
        },
        create: {
          sellerId: seller.id,
          slug,
          storeName,
          description: `${suffix} serving the ${neighborhood} area.`,
          approvalStatus: STOREAPPROVALSTATUS.ACTIVE,
          isActive: true,
          primaryCategoryId: categoryId,
          phone: `+63917${String(1000000 + globalIndex).slice(0, 7)}`,
          email: `bulk.store${globalIndex}@mapanytime.test`,
        },
      });

      await prisma.storeLocations.upsert({
        where: { storeId: store.id },
        update: { latitude, longitude },
        create: {
          storeId: store.id,
          currentAddress: `${neighborhood}, Baguio City`,
          homeAddress: `${neighborhood}, Baguio City`,
          city: 'Baguio City',
          province: 'Benguet',
          zipCode: '2600',
          country: 'Philippines',
          latitude,
          longitude,
        },
      });

      for (const hour of WEEKLY_HOURS) {
        await prisma.storeHours.upsert({
          where: { storeId_dayOfWeek: { storeId: store.id, dayOfWeek: hour.dayOfWeek } },
          update: {},
          create: { storeId: store.id, ...hour },
        });
      }

      // Only stock a store that has nothing yet — re-running must not
      // duplicate or clobber rows an order/cart may already reference.
      const existingProductCount = await prisma.products.count({ where: { storeId: store.id } });
      if (existingProductCount === 0) {
        const productCount = MIN_PRODUCTS + Math.floor(rng() * (MAX_PRODUCTS - MIN_PRODUCTS + 1));
        const picks = shuffled(productPool, rng).slice(
          0,
          Math.min(productCount, productPool.length),
        );

        for (const p of picks) {
          // Small deterministic price jitter so identical items across
          // stores aren't all priced exactly the same.
          const jitter = 0.9 + rng() * 0.3; // 0.9x - 1.2x
          const price = Math.max(1, Math.round(p.price * jitter));
          const quantityOnHand = 10 + Math.floor(rng() * 90);

          const product = await prisma.products.create({
            data: {
              storeId: store.id,
              categoryId,
              name: p.name,
              brand: p.brand,
              description: `${p.name} available at ${storeName}.`,
              price,
              status: PRODUCTSTATUS.APPROVED,
              isActive: true,
              listedAt: new Date(),
            },
          });
          await prisma.inventory.create({
            data: {
              storeId: store.id,
              productId: product.id,
              quantityOnHand,
              quantityReserved: 0,
            },
          });
        }
        productTotal += picks.length;
      } else {
        productTotal += existingProductCount;
      }

      storeCount++;
      globalIndex++;
    }
  }

  console.log(
    `✅ Bulk map stores seeded: ${storeCount} stores, ~${productTotal} products, across ${CATEGORY_SPECS.length} categories.`,
  );
}
