-- Promotion badges: a normalized lookup of preset badge labels sellers can
-- pick for a promotion, replacing the free-text-only badgeLabel input.
--
-- MerchantAds.badgeLabel is kept and NOT backfilled from this table — it
-- remains the denormalized display string (the picked badge's label, or a
-- seller-typed custom string when badgeId is NULL). Buyer-facing reads
-- (the /nearby feed, the mobile app) use it directly with no join.
--
-- Ids are deterministic so this migration is idempotent against a database
-- that already has these rows from prisma/seeders/promotion_badges.seeder.ts.
-- Kept in sync with that seeder.

-- ---------------------------------------------------------------------------
-- 1. Lookup table
-- ---------------------------------------------------------------------------

CREATE TABLE "PromotionBadges" (
    "id"          TEXT NOT NULL,
    "slug"        TEXT NOT NULL,
    "label"       TEXT NOT NULL,
    "description" TEXT,
    "position"    INTEGER NOT NULL DEFAULT 0,
    "isActive"    BOOLEAN NOT NULL DEFAULT true,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PromotionBadges_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PromotionBadges_slug_key" ON "PromotionBadges"("slug");
CREATE INDEX "PromotionBadges_isActive_position_idx" ON "PromotionBadges"("isActive", "position");

-- ---------------------------------------------------------------------------
-- 2. Preset options
-- ---------------------------------------------------------------------------

INSERT INTO "PromotionBadges" ("id", "slug", "label", "description", "position", "updatedAt") VALUES
    ('badge_seed_hot',            'HOT',            'Hot',            'Great for trending or fast-moving items',            0,  CURRENT_TIMESTAMP),
    ('badge_seed_sale_now',       'SALE_NOW',       'Sale Now',       'Directly signals an active price drop',              1,  CURRENT_TIMESTAMP),
    ('badge_seed_flash_sale',     'FLASH_SALE',     'Flash Sale',     'Implies a very short, time-sensitive window',        2,  CURRENT_TIMESTAMP),
    ('badge_seed_trending',       'TRENDING',       'Trending',       'Capitalizes on popularity',                          3,  CURRENT_TIMESTAMP),
    ('badge_seed_limited_offer',  'LIMITED_OFFER',  'Limited Offer',  'Creates FOMO with a limited-time window',            4,  CURRENT_TIMESTAMP),
    ('badge_seed_ending_soon',    'ENDING_SOON',    'Ending Soon',    'Great for items where the timer is about to run out', 5, CURRENT_TIMESTAMP),
    ('badge_seed_last_few_left',  'LAST_FEW_LEFT',  'Last Few Left',  'Highlights low remaining stock paired with a promo', 6,  CURRENT_TIMESTAMP),
    ('badge_seed_best_value',     'BEST_VALUE',     'Best Value',     'Highlights the highest savings or bundle deals',     7,  CURRENT_TIMESTAMP),
    ('badge_seed_price_drop',     'PRICE_DROP',     'Price Drop',     'Signals a permanent or significant reduction',       8,  CURRENT_TIMESTAMP),
    ('badge_seed_special_deal',   'SPECIAL_DEAL',   'Special Deal',   'Good for exclusive store discounts',                 9,  CURRENT_TIMESTAMP),
    ('badge_seed_bundle_deal',    'BUNDLE_DEAL',    'Bundle Deal',    'Perfect for Buy 1 Take 1 or multi-item promotions',  10, CURRENT_TIMESTAMP),
    ('badge_seed_exclusive',      'EXCLUSIVE',      'Exclusive',      'For member-only or store-specific promotions',       11, CURRENT_TIMESTAMP),
    ('badge_seed_featured',       'FEATURED',       'Featured',       'Highlights hand-picked items by the seller',         12, CURRENT_TIMESTAMP),
    ('badge_seed_top_pick',       'TOP_PICK',       'Top Pick',       'Builds trust alongside a discount',                  13, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. MerchantAds.badgeId
-- ---------------------------------------------------------------------------

ALTER TABLE "MerchantAds" ADD COLUMN "badgeId" TEXT;

CREATE INDEX "MerchantAds_badgeId_idx" ON "MerchantAds"("badgeId");

-- ON DELETE SET NULL: deactivating/removing a badge must never orphan or
-- block deletion of a promotion that already used it. badgeLabel keeps the
-- snapshot even if the badge row later disappears.
ALTER TABLE "MerchantAds"
    ADD CONSTRAINT "MerchantAds_badgeId_fkey"
    FOREIGN KEY ("badgeId") REFERENCES "PromotionBadges"("id") ON DELETE SET NULL ON UPDATE CASCADE;
