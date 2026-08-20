-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.

-- `IF NOT EXISTS` added 2026-08-20. `20260819054809_ads_payment_promotio_order_sync`
-- already CREATEs "ORDERCHARGETYPE" containing all four of these values, so a
-- plain ADD VALUE fails with `enum label "SELLER_SUBSIDY" already exists` the
-- moment the migration history is replayed from scratch.
--
-- That never showed up locally because `migrate dev` only applies migrations the
-- dev database has not seen — but the shadow database replays every migration,
-- so `migrate dev` broke, and `migrate deploy` against a fresh database (a new
-- environment, or a restored backup) would have broken the same way.
--
-- IF NOT EXISTS is correct either way: it is a no-op where the CREATE TYPE
-- already supplied the value, and still adds it on any database provisioned
-- before that migration carried them.

ALTER TYPE "ORDERCHARGETYPE" ADD VALUE IF NOT EXISTS 'SELLER_SUBSIDY';
ALTER TYPE "ORDERCHARGETYPE" ADD VALUE IF NOT EXISTS 'CAMPAIGN';
ALTER TYPE "ORDERCHARGETYPE" ADD VALUE IF NOT EXISTS 'REFUND';
ALTER TYPE "ORDERCHARGETYPE" ADD VALUE IF NOT EXISTS 'ADJUSTMENT';
