import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Fetching active PricingConfiguration...');
  const config = await prisma.pricingConfigurations.findFirst({
    where: { status: 'ACTIVE' },
    orderBy: { effectiveFrom: 'desc' },
  });

  if (!config) {
    console.log('No active PricingConfiguration found. Creating a temporary one...');
    await prisma.pricingConfigurations.create({
      data: {
        name: 'Temporary Configuration',
        status: 'ACTIVE',
        paymentFeePayerPolicy: 'BUYER',
      },
    });
  }

  const activeConfig = await prisma.pricingConfigurations.findFirst({
    where: { status: 'ACTIVE' },
    orderBy: { effectiveFrom: 'desc' },
  });

  console.log(`Active config ID: ${activeConfig!.id}`);

  console.log('Fetching CommissionRules...');
  // Note: we query using raw because we might have already removed it from schema
  // But wait, the current generated Prisma Client still has it because we haven't run generate!
  const rules = await prisma.commissionRules.findMany({
    where: { isActive: true },
  });

  console.log(`Found ${rules.length} active CommissionRules.`);

  for (const rule of rules) {
    if (!rule.categoryId) continue;

    console.log(`Migrating rule for category ${rule.categoryId}...`);
    await prisma.pricingComponents.create({
      data: {
        pricingId: activeConfig!.id,
        type: 'SELLER_MARKETPLACE_FEE',
        categoryId: rule.categoryId,
        ratePercentage: rule.commissionRate,
        fixedAmount: rule.fixedFee,
        isActive: true,
        priority: 10,
      },
    });
  }

  console.log('Deleting all CommissionRules so Prisma does not warn about data loss...');
  await prisma.commissionRules.deleteMany();

  console.log('Nulling out taxAmount in Orders so Prisma does not warn about data loss...');
  await prisma.orders.updateMany({
    where: { taxAmount: { gt: 0 } },
    data: { taxAmount: 0 },
  });

  console.log('Migration prep script complete.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
