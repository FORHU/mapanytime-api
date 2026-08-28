import { PrismaClient, STOREAPPROVALSTATUS, MARKERDISPLAYMODE } from '@prisma/client';

// Showcases the non-photo-card marker modes. `PRICE_CARD` stores are
// rentals/hotels (Airbnb-style price-per-night pin); `LABEL_CARD` stores are
// second-hand marketplace items — since there's no individual-listing entity
// yet, each item-for-sale is its own one-item "store" with the item's own
// name as `storeName`, so the marker reads as "car name and year" rather
// than a dealership name.
interface MarkerShowcaseSpec {
  slug: string;
  storeName: string;
  description: string;
  categoryName: string;
  ownerEmail: string;
  phone: string;
  email: string;
  address: {
    currentAddress: string;
    city: string;
    province: string;
    zipCode: string;
    country: string;
  };
  coordinates: {
    latitude: number;
    longitude: number;
  };
  markerDisplayMode: MARKERDISPLAYMODE;
  markerPrice?: number;
  markerSubtitle?: string;
}

const WEEKLY_HOURS = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
  dayOfWeek,
  openMinutes: 0,
  closeMinutes: 24 * 60,
  isClosed: false,
}));

const MARKER_SHOWCASE_CATALOG: MarkerShowcaseSpec[] = [
  {
    slug: 'pine-haven-transient-rooms',
    storeName: 'Pine Haven Transient Rooms',
    description: 'Cozy transient rooms near Session Road, walking distance to the night market.',
    // The 'Services' root was removed from the product taxonomy (see
    // categories.seeder.ts) — room rentals have no product-type home until the
    // separate Service entity model ships, so this placeholder uses 'Others'.
    categoryName: 'Others',
    ownerEmail: 'seller@example.com',
    phone: '+639171234501',
    email: 'pinehaven@mapanytime.test',
    address: {
      currentAddress: '12 Assumption Rd',
      city: 'Baguio City',
      province: 'Benguet',
      zipCode: '2600',
      country: 'Philippines',
    },
    coordinates: { latitude: 16.4127, longitude: 120.5938 },
    markerDisplayMode: MARKERDISPLAYMODE.PRICE_CARD,
    markerPrice: 1800,
  },
  {
    slug: 'camp-john-hay-staycation-cabin',
    storeName: 'Camp John Hay Staycation Cabin',
    description: 'Pine-forest cabin rental inside Camp John Hay, sleeps up to 4.',
    // Same placeholder rationale as above — see comment on the previous entry.
    categoryName: 'Others',
    ownerEmail: 'seller@example.com',
    phone: '+639171234502',
    email: 'cjhcabin@mapanytime.test',
    address: {
      currentAddress: 'Loakan Rd, Camp John Hay',
      city: 'Baguio City',
      province: 'Benguet',
      zipCode: '2600',
      country: 'Philippines',
    },
    coordinates: { latitude: 16.3958, longitude: 120.6151 },
    markerDisplayMode: MARKERDISPLAYMODE.PRICE_CARD,
    markerPrice: 3500,
  },
  {
    slug: 'toyota-vios-2021',
    storeName: 'Toyota Vios 2021',
    description: 'Second-hand Toyota Vios 2021, single owner, complete papers.',
    categoryName: 'Automotive',
    ownerEmail: 'seller@example.com',
    phone: '+639171234503',
    email: 'vios2021@mapanytime.test',
    address: {
      currentAddress: 'Marcos Highway',
      city: 'Baguio City',
      province: 'Benguet',
      zipCode: '2600',
      country: 'Philippines',
    },
    coordinates: { latitude: 16.4203, longitude: 120.6042 },
    markerDisplayMode: MARKERDISPLAYMODE.LABEL_CARD,
    markerSubtitle: 'Automatic · 45,000 km',
  },
  {
    slug: 'iphone-14-pro-resale',
    storeName: 'iPhone 14 Pro',
    description: 'Second-hand iPhone 14 Pro, like new condition, with box and accessories.',
    categoryName: 'Electronics',
    ownerEmail: 'seller@example.com',
    phone: '+639171234504',
    email: 'iphone14pro@mapanytime.test',
    address: {
      currentAddress: 'Upper Session Rd',
      city: 'Baguio City',
      province: 'Benguet',
      zipCode: '2600',
      country: 'Philippines',
    },
    coordinates: { latitude: 16.4144, longitude: 120.5967 },
    markerDisplayMode: MARKERDISPLAYMODE.LABEL_CARD,
    markerSubtitle: '128GB · Like New',
  },
];

export async function seedMarkerShowcase(prisma: PrismaClient) {
  const categories = await prisma.categories.findMany();
  const categoryMap = new Map<string, string>();
  for (const cat of categories) {
    categoryMap.set(cat.name.toLowerCase(), cat.id);
  }

  for (const spec of MARKER_SHOWCASE_CATALOG) {
    const user = await prisma.users.findUnique({
      where: { email: spec.ownerEmail },
    });

    if (!user) {
      console.log(
        `⚠️ User not found for email: ${spec.ownerEmail}. Skipping store: ${spec.storeName}`,
      );
      continue;
    }

    const seller = await prisma.sellers.upsert({
      where: { userId: user.id },
      update: {
        applicationStatus: 'APPROVED',
        onboardingStep: 4,
      },
      create: {
        userId: user.id,
        applicationStatus: 'APPROVED',
        onboardingStep: 4,
        sellerPlan: 'PRO',
      },
    });

    const categoryId = categoryMap.get(spec.categoryName.toLowerCase()) || categories[0]?.id;

    const store = await prisma.stores.upsert({
      where: { slug: spec.slug },
      update: {
        storeName: spec.storeName,
        description: spec.description,
        approvalStatus: STOREAPPROVALSTATUS.ACTIVE,
        isActive: true,
        primaryCategoryId: categoryId,
        phone: spec.phone,
        email: spec.email,
        markerDisplayMode: spec.markerDisplayMode,
        markerPrice: spec.markerPrice ?? null,
        markerSubtitle: spec.markerSubtitle ?? null,
      },
      create: {
        sellerId: seller.id,
        slug: spec.slug,
        storeName: spec.storeName,
        description: spec.description,
        approvalStatus: STOREAPPROVALSTATUS.ACTIVE,
        isActive: true,
        primaryCategoryId: categoryId,
        phone: spec.phone,
        email: spec.email,
        markerDisplayMode: spec.markerDisplayMode,
        markerPrice: spec.markerPrice ?? null,
        markerSubtitle: spec.markerSubtitle ?? null,
      },
    });

    await prisma.storeLocations.upsert({
      where: { storeId: store.id },
      update: {
        currentAddress: spec.address.currentAddress,
        homeAddress: spec.address.currentAddress,
        city: spec.address.city,
        province: spec.address.province,
        zipCode: spec.address.zipCode,
        country: spec.address.country,
        latitude: spec.coordinates.latitude,
        longitude: spec.coordinates.longitude,
      },
      create: {
        storeId: store.id,
        currentAddress: spec.address.currentAddress,
        homeAddress: spec.address.currentAddress,
        city: spec.address.city,
        province: spec.address.province,
        zipCode: spec.address.zipCode,
        country: spec.address.country,
        latitude: spec.coordinates.latitude,
        longitude: spec.coordinates.longitude,
      },
    });

    for (const hour of WEEKLY_HOURS) {
      await prisma.storeHours.upsert({
        where: {
          storeId_dayOfWeek: {
            storeId: store.id,
            dayOfWeek: hour.dayOfWeek,
          },
        },
        update: {
          openMinutes: hour.openMinutes,
          closeMinutes: hour.closeMinutes,
          isClosed: hour.isClosed,
        },
        create: {
          storeId: store.id,
          dayOfWeek: hour.dayOfWeek,
          openMinutes: hour.openMinutes,
          closeMinutes: hour.closeMinutes,
          isClosed: hour.isClosed,
        },
      });
    }

    console.log(
      `✅ Seeded marker-showcase store "${store.storeName}" (${spec.slug}) — ${spec.markerDisplayMode}.`,
    );
  }

  console.log('✅ Marker display mode showcase stores seeded successfully!');
}
