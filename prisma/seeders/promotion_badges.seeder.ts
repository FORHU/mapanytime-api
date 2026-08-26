import { PrismaClient } from '@prisma/client';

/**
 * Preset badge options sellers can pick for a promotion's badgeLabel.
 * Kept in sync with the INSERTs in
 * prisma/migrations/20260826080000_promotion_badges/migration.sql, which
 * seeds the same rows for databases that only run migrations (production).
 */
export const PROMOTION_BADGES = [
  { slug: 'HOT', label: 'Hot', description: 'Great for trending or fast-moving items' },
  { slug: 'SALE_NOW', label: 'Sale Now', description: 'Directly signals an active price drop' },
  {
    slug: 'FLASH_SALE',
    label: 'Flash Sale',
    description: 'Implies a very short, time-sensitive window',
  },
  { slug: 'TRENDING', label: 'Trending', description: 'Capitalizes on popularity' },
  {
    slug: 'LIMITED_OFFER',
    label: 'Limited Offer',
    description: 'Creates FOMO with a limited-time window',
  },
  {
    slug: 'ENDING_SOON',
    label: 'Ending Soon',
    description: 'Great for items where the timer is about to run out',
  },
  {
    slug: 'LAST_FEW_LEFT',
    label: 'Last Few Left',
    description: 'Highlights low remaining stock paired with a promo',
  },
  {
    slug: 'BEST_VALUE',
    label: 'Best Value',
    description: 'Highlights the highest savings or bundle deals',
  },
  {
    slug: 'PRICE_DROP',
    label: 'Price Drop',
    description: 'Signals a permanent or significant reduction',
  },
  {
    slug: 'SPECIAL_DEAL',
    label: 'Special Deal',
    description: 'Good for exclusive store discounts',
  },
  {
    slug: 'BUNDLE_DEAL',
    label: 'Bundle Deal',
    description: 'Perfect for Buy 1 Take 1 or multi-item promotions',
  },
  {
    slug: 'EXCLUSIVE',
    label: 'Exclusive',
    description: 'For member-only or store-specific promotions',
  },
  {
    slug: 'FEATURED',
    label: 'Featured',
    description: 'Highlights hand-picked items by the seller',
  },
  { slug: 'TOP_PICK', label: 'Top Pick', description: 'Builds trust alongside a discount' },
] as const;

export async function seedPromotionBadges(prisma: PrismaClient) {
  console.log('🌱 Seeding promotion badges...');

  for (const [position, badge] of PROMOTION_BADGES.entries()) {
    await prisma.promotionBadges.upsert({
      where: { slug: badge.slug },
      update: { label: badge.label, description: badge.description, position },
      create: { ...badge, position },
    });
  }

  console.log(`✅ Seeded ${PROMOTION_BADGES.length} promotion badges`);
}
