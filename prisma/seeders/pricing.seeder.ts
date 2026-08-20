import { PrismaClient, PRICINGCOMPONENTTYPE, PRICINGCALCULATIONTYPE } from '@prisma/client';

/**
 * The live PayMongo rate card, as contracted. These are the rates the platform
 * is actually billed per successful transaction; the buyer covers them (BUYER
 * payer policy), so the platform keeps exactly its commission.
 *
 * Seeding these is what closes FLAGS.md F2 — without an ACTIVE configuration
 * the engine falls back to a flat 2.00% for every non-cash method, which
 * undercharges cards badly and overcharges Maya.
 */
const PAYMONGO_RATES = [
  { code: 'GCASH', rate: 0.0223, fixed: 0, label: 'GCash 2.23%' },
  { code: 'MAYA', rate: 0.0179, fixed: 0, label: 'Maya 1.79%' },
  {
    code: 'CARD',
    rate: 0.03125,
    fixed: 13.39,
    label: 'Domestic Visa/Mastercard 3.125% + P13.39',
    // A P13.39 flat fee is 17% of a P100 basket. Cards are gated above this so
    // small orders are steered to GCash/Maya rather than shown a punitive rate.
    minOrderAmount: 500,
  },
];

/**
 * Methods with no contracted rate on file. Left active so the checkout flow is
 * unchanged, but they price off the engine's fallback constant until a rate is
 * supplied — which will understate the real cost if it is above 2.00%.
 */
const RATES_UNKNOWN = ['QRPH', 'GRAB_PAY'];

export async function seedPricingConfiguration(prisma: PrismaClient) {
  console.log('Seeding Pricing Configuration...');

  const paymongo = await prisma.paymentProviders.findUnique({ where: { code: 'PAYMONGO' } });
  if (!paymongo) {
    console.warn('  PayMongo provider not found — run the payments seeder first. Skipping.');
    return;
  }

  const existing = await prisma.pricingConfigurations.findFirst({
    where: { name: 'PayMongo Standard Rates v1' },
  });

  const config =
    existing ??
    (await prisma.pricingConfigurations.create({
      data: {
        name: 'PayMongo Standard Rates v1',
        description:
          'Contracted PayMongo per-transaction rates. Buyer covers the gateway fee; ' +
          'platform revenue is the 2% seller commission alone.',
        status: 'ACTIVE',
        currency: 'PHP',
        priority: 1,
      },
    }));

  // Seller marketplace commission — the platform's only revenue line.
  await upsertComponent(prisma, config.id, {
    type: PRICINGCOMPONENTTYPE.SELLER_MARKETPLACE_FEE,
    calculationType: PRICINGCALCULATIONTYPE.PERCENTAGE,
    ratePercentage: 0.02,
    fixedAmount: null,
    priority: 100,
  });

  for (const r of PAYMONGO_RATES) {
    const method = await prisma.paymentMethods.findUnique({
      where: { providerId_code: { providerId: paymongo.id, code: r.code } },
    });
    if (!method) {
      console.warn(`  Payment method ${r.code} not found — skipping its rate.`);
      continue;
    }

    await upsertComponent(prisma, config.id, {
      type: PRICINGCOMPONENTTYPE.PAYMENT_PROCESSING_FEE,
      calculationType: r.fixed
        ? PRICINGCALCULATIONTYPE.PERCENTAGE_AND_FIXED
        : PRICINGCALCULATIONTYPE.PERCENTAGE,
      ratePercentage: r.rate,
      fixedAmount: r.fixed || null,
      providerId: paymongo.id,
      paymentMethodId: method.id,
      priority: 100,
    });

    if (r.minOrderAmount !== undefined) {
      await prisma.paymentMethods.update({
        where: { id: method.id },
        data: { minOrderAmount: r.minOrderAmount },
      });
    }

    console.log(`  ${r.label}`);
  }

  for (const code of RATES_UNKNOWN) {
    console.warn(`  ${code}: no contracted rate on file — will price off the 2.00% fallback.`);
  }

  console.log('Pricing Configuration seeded successfully.');
}

async function upsertComponent(
  prisma: PrismaClient,
  pricingId: string,
  data: {
    type: PRICINGCOMPONENTTYPE;
    calculationType: PRICINGCALCULATIONTYPE;
    ratePercentage: number;
    fixedAmount: number | null;
    providerId?: string;
    paymentMethodId?: string;
    priority: number;
  },
) {
  const existing = await prisma.pricingComponents.findFirst({
    where: {
      pricingId,
      type: data.type,
      providerId: data.providerId ?? null,
      paymentMethodId: data.paymentMethodId ?? null,
    },
  });

  if (existing) {
    await prisma.pricingComponents.update({
      where: { id: existing.id },
      data: {
        calculationType: data.calculationType,
        ratePercentage: data.ratePercentage,
        fixedAmount: data.fixedAmount,
        isActive: true,
        priority: data.priority,
      },
    });
    return;
  }

  await prisma.pricingComponents.create({
    data: {
      pricingId,
      type: data.type,
      calculationType: data.calculationType,
      ratePercentage: data.ratePercentage,
      fixedAmount: data.fixedAmount,
      providerId: data.providerId,
      paymentMethodId: data.paymentMethodId,
      isActive: true,
      priority: data.priority,
    },
  });
}
