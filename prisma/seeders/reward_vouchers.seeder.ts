import { PrismaClient } from '@prisma/client';

/**
 * MapPoints voucher catalog. Point costs assume the default config (1 point
 * = ₱0.10) — each voucher costs roughly 10x its ₱ value in points, cheaper
 * for the smaller/no-minimum ones to keep the entry tier reachable.
 */
export const REWARD_VOUCHERS = [
  {
    title: '₱25 Off',
    description: 'Take ₱25 off any order.',
    pointCost: 250,
    discountType: 'FIXED' as const,
    discountValue: 25,
    minOrderAmount: 200,
    validityDays: 30,
  },
  {
    title: '₱50 Off',
    description: 'Take ₱50 off any order.',
    pointCost: 500,
    discountType: 'FIXED' as const,
    discountValue: 50,
    minOrderAmount: 400,
    validityDays: 30,
  },
  {
    title: '₱100 Off',
    description: 'Take ₱100 off orders of ₱800 or more.',
    pointCost: 1000,
    discountType: 'FIXED' as const,
    discountValue: 100,
    minOrderAmount: 800,
    totalStock: 200,
    validityDays: 30,
  },
  {
    title: '5% Off Storewide',
    description: '5% off, capped at ₱100 off.',
    pointCost: 150,
    discountType: 'PERCENTAGE' as const,
    discountValue: 5,
    maxDiscountAmount: 100,
    validityDays: 30,
  },
  {
    title: '10% Off Storewide',
    description: '10% off orders of ₱500 or more, capped at ₱250 off.',
    pointCost: 350,
    discountType: 'PERCENTAGE' as const,
    discountValue: 10,
    minOrderAmount: 500,
    maxDiscountAmount: 250,
    validityDays: 30,
  },
  {
    title: '15% Off Big Purchase',
    description: '15% off orders of ₱1,500 or more, capped at ₱500 off.',
    pointCost: 800,
    discountType: 'PERCENTAGE' as const,
    discountValue: 15,
    minOrderAmount: 1500,
    maxDiscountAmount: 500,
    totalStock: 100,
    validityDays: 45,
  },
] as const;

/** Upserts by title so reseeding never duplicates rows. */
export async function seedRewardVouchers(prisma: PrismaClient) {
  console.log('🌱 Seeding MapPoints voucher catalog...');

  for (const voucher of REWARD_VOUCHERS) {
    const { title, ...data } = voucher;
    const existing = await prisma.rewardVouchers.findFirst({ where: { title } });

    if (existing) {
      await prisma.rewardVouchers.update({
        where: { id: existing.id },
        data: { ...data, isActive: true },
      });
    } else {
      await prisma.rewardVouchers.create({ data: { title, ...data } });
    }
  }

  console.log(`✅ Seeded ${REWARD_VOUCHERS.length} MapPoints vouchers`);
}
