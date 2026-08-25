import { Prisma, PrismaClient } from '@prisma/client';
import { liveWindowFilter } from '../merchantAds/adWindow';

type DbClient = Prisma.TransactionClient | PrismaClient;

type DiscountAd = {
  id: string;
  discountType: string | null;
  discountValue: unknown;
  buyQuantity: number | null;
  freeQuantity: number | null;
};

function discountForAd(
  ad: DiscountAd,
  itemTotal: number,
  quantity: number,
  unitPrice: number,
): { itemDiscount: number; appliedAdId: string | null; freeUnits: number } {
  if (ad.discountType === 'PERCENTAGE' && ad.discountValue) {
    return {
      itemDiscount: itemTotal * (Number(ad.discountValue) / 100),
      appliedAdId: ad.id,
      freeUnits: 0,
    };
  }

  if (ad.discountType === 'FIXED_AMOUNT' && ad.discountValue) {
    return {
      itemDiscount: Math.min(itemTotal, Number(ad.discountValue) * quantity),
      appliedAdId: ad.id,
      freeUnits: 0,
    };
  }

  if (ad.buyQuantity && ad.freeQuantity) {
    // Bundle size is buy+free (e.g. "buy 1 take 1" = pay for 1, get 2 total
    // per bundle) — dividing by buyQuantity alone would give away a free
    // unit for every single unit bought, not every pair.
    const bundleSize = ad.buyQuantity + ad.freeQuantity;
    const freeUnits = Math.min(quantity, Math.floor(quantity / bundleSize) * ad.freeQuantity);
    if (freeUnits > 0) {
      return { itemDiscount: freeUnits * unitPrice, appliedAdId: ad.id, freeUnits };
    }
  }

  return { itemDiscount: 0, appliedAdId: null, freeUnits: 0 };
}

/**
 * Finds every active discount ad (BOGO, % off, or fixed-amount off) linked
 * to a product for a store and returns whichever yields the largest discount
 * for the given quantity. A product can have more than one live ad linked to
 * it (e.g. a BOGO promo that doesn't reach its bundle size at this quantity,
 * alongside a % off promo that does apply) — picking arbitrarily between them
 * could silently show $0 off when a real discount was available.
 * Shared by order creation and the cart pricing preview so what a buyer sees
 * before checkout can never drift from what they're actually charged.
 */
export async function computeItemDiscount(
  client: DbClient,
  params: { productId: string; quantity: number; storeId: string; unitPrice: number },
): Promise<{ itemDiscount: number; appliedAdId: string | null; freeUnits: number }> {
  const now = new Date();

  const discountLinks = await client.merchantAdProducts.findMany({
    where: {
      productId: params.productId,
      ad: {
        storeId: params.storeId,
        discountType: { not: null },
        ...liveWindowFilter(now),
      },
    },
    include: { ad: true },
  });

  const itemTotal = params.unitPrice * params.quantity;
  let best = { itemDiscount: 0, appliedAdId: null as string | null, freeUnits: 0 };

  for (const link of discountLinks) {
    const candidate = discountForAd(link.ad, itemTotal, params.quantity, params.unitPrice);
    if (candidate.itemDiscount > best.itemDiscount) {
      best = candidate;
    }
  }

  return best;
}

/**
 * Given the quantity a buyer intends to pay for, returns the actual
 * quantity to store in their cart if an active BOGO ad is linked to this
 * product — their paid quantity plus whatever free bonus units it earns,
 * capped at available stock so a bonus is never promised beyond what's in
 * stock. Returns the quantity unchanged if no BOGO ad applies.
 *
 * This lets the buyer add only the "buy" amount (e.g. 2 for a "buy 2 get 1
 * free" ad) instead of having to also manually add the free units
 * themselves — `computeItemDiscount` already derives the right discount
 * from a bundle-complete quantity, so bumping it once here at the moment
 * it's stored is the only change needed; pricing preview and order
 * creation both already read whatever quantity ends up in the cart.
 */
export async function applyBogoBonus(
  client: DbClient,
  params: { productId: string; storeId: string; quantity: number; availableStock: number },
): Promise<number> {
  const discountLinks = await client.merchantAdProducts.findMany({
    where: {
      productId: params.productId,
      ad: {
        storeId: params.storeId,
        discountType: 'BOGO',
        // Same window test as computeItemDiscount — a BOGO that has not
        // started yet must not hand out bonus units at add-to-cart time.
        ...liveWindowFilter(),
      },
    },
    include: { ad: true },
  });

  let bonusUnits = 0;
  for (const link of discountLinks) {
    const { buyQuantity, freeQuantity } = link.ad;
    if (!buyQuantity || !freeQuantity) continue;
    const bundles = Math.floor(params.quantity / buyQuantity);
    bonusUnits = Math.max(bonusUnits, bundles * freeQuantity);
  }

  return Math.min(params.quantity + bonusUnits, params.availableStock);
}
