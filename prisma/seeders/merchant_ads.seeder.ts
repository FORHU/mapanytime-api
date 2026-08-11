import { PrismaClient, MERCHANTADKIND } from '@prisma/client';

/**
 * Merchant ads covering every kind + the BOGO and stock-linked-event flows
 * exercised by order.service.bogo.test.ts and store.service.test.ts.
 */
export async function seedMerchantAds(prisma: PrismaClient) {
  console.log('Seeding MerchantAds...');

  await prisma.merchantAdProducts.deleteMany();
  await prisma.merchantAds.deleteMany();

  const findStoreProduct = async (storeName: string, productName: string) => {
    const store = await prisma.stores.findFirst({ where: { storeName } });
    if (!store) return null;
    const product = await prisma.products.findFirst({
      where: { storeId: store.id, name: productName },
    });
    if (!product) return null;
    return { store, product };
  };

  // ── BOGO promo: Buy 1 Take 1 Fresh Strawberries ──────────────────────────
  const bogo = await findStoreProduct('Baguio Fresh Market', 'Fresh Strawberries (1kg)');
  if (bogo) {
    const ad = await prisma.merchantAds.create({
      data: {
        storeId: bogo.store.id,
        kind: MERCHANTADKIND.PROMO,
        title: 'Buy 1 Take 1 Strawberries',
        description: 'Grab a kilo of fresh strawberries and get a second one free.',
        badgeLabel: 'BOGO',
        buyQuantity: 1,
        freeQuantity: 1,
        isActive: true,
      },
    });
    await prisma.merchantAdProducts.create({
      data: { adId: ad.id, productId: bogo.product.id },
    });
  }

  // ── Stock-linked event, still live ───────────────────────────────────────
  const liveEvent = await findStoreProduct('TechHub Baguio', 'Wireless Mouse');
  if (liveEvent) {
    const ad = await prisma.merchantAds.create({
      data: {
        storeId: liveEvent.store.id,
        kind: MERCHANTADKIND.EVENT,
        title: 'Tech Weekend Flash Sale',
        description: 'Limited-time discount on wireless mice while supplies last.',
        badgeLabel: 'FLASH SALE',
        ctaLabel: 'Shop Now',
        isActive: true,
      },
    });
    await prisma.merchantAdProducts.create({
      data: { adId: ad.id, productId: liveEvent.product.id },
    });
  }

  // ── Stock-linked event, sold out (its linked inventory is fully reserved) ─
  const soldOutEvent = await findStoreProduct('TechHub Baguio', 'Gaming Headset');
  if (soldOutEvent) {
    const ad = await prisma.merchantAds.create({
      data: {
        storeId: soldOutEvent.store.id,
        kind: MERCHANTADKIND.EVENT,
        title: 'Gaming Headset Doorbuster',
        description: 'Doorbuster pricing on our top gaming headset.',
        badgeLabel: 'SOLD OUT',
        isActive: true,
      },
    });
    await prisma.merchantAdProducts.create({
      data: { adId: ad.id, productId: soldOutEvent.product.id },
    });

    const inv = await prisma.inventory.findFirst({ where: { productId: soldOutEvent.product.id } });
    if (inv) {
      await prisma.inventory.update({
        where: { id: inv.id },
        data: { quantityReserved: inv.quantityOnHand },
      });
    }
  }

  // ── Job posting ───────────────────────────────────────────────────────────
  const jobStore = await prisma.stores.findFirst({ where: { storeName: 'Session Brews Cafe' } });
  if (jobStore) {
    await prisma.merchantAds.create({
      data: {
        storeId: jobStore.id,
        kind: MERCHANTADKIND.JOB,
        title: 'Barista Wanted (Part-Time)',
        description: 'Session Brews Cafe is hiring a part-time barista for weekend shifts.',
        salaryLabel: '₱80/hr',
        ctaLabel: 'Apply',
        isActive: true,
      },
    });
  }

  console.log('MerchantAds seeded (BOGO, live event, sold-out event, job posting)!');
}
