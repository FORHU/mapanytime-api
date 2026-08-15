import { Prisma, PrismaClient } from '@prisma/client';

type DbClient = Prisma.TransactionClient | PrismaClient;

/**
 * Finds the active discount ad (BOGO, % off, or fixed-amount off) linked to
 * a product for a store and computes the discount for the given quantity.
 * Shared by order creation and the cart pricing preview so what a buyer sees
 * before checkout can never drift from what they're actually charged.
 */
export async function computeItemDiscount(
  client: DbClient,
  params: { productId: string; quantity: number; storeId: string; unitPrice: number },
): Promise<{ itemDiscount: number; appliedAdId: string | null }> {
  const discountLink = await client.merchantAdProducts.findFirst({
    where: {
      productId: params.productId,
      ad: {
        storeId: params.storeId,
        isActive: true,
        discountType: { not: null },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    },
    include: { ad: true },
  });
  const discountAd = discountLink?.ad;
  const itemTotal = params.unitPrice * params.quantity;

  if (discountAd?.discountType === 'PERCENTAGE' && discountAd.discountValue) {
    return {
      itemDiscount: itemTotal * (Number(discountAd.discountValue) / 100),
      appliedAdId: discountAd.id,
    };
  }

  if (discountAd?.discountType === 'FIXED_AMOUNT' && discountAd.discountValue) {
    return {
      itemDiscount: Math.min(itemTotal, Number(discountAd.discountValue) * params.quantity),
      appliedAdId: discountAd.id,
    };
  }

  if (discountAd?.buyQuantity && discountAd?.freeQuantity) {
    // Bundle size is buy+free (e.g. "buy 1 take 1" = pay for 1, get 2 total
    // per bundle) — dividing by buyQuantity alone would give away a free
    // unit for every single unit bought, not every pair.
    const bundleSize = discountAd.buyQuantity + discountAd.freeQuantity;
    const freeUnits = Math.min(
      params.quantity,
      Math.floor(params.quantity / bundleSize) * discountAd.freeQuantity,
    );
    if (freeUnits > 0) {
      return { itemDiscount: freeUnits * params.unitPrice, appliedAdId: discountAd.id };
    }
  }

  return { itemDiscount: 0, appliedAdId: null };
}
