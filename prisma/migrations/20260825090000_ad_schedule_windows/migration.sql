-- Ad schedule windows: gives MerchantAds a start boundary and a declared
-- timezone to interpret seller-entered wall-clock times against.
--
-- SAFETY: "startAt" is nullable and every existing row backfills to NULL,
-- which deriveAdState() reads as "no start constraint — already running".
-- A NOT NULL column or a NOW() backfill would re-evaluate every live
-- promotion at deploy time and take some of them dark.

-- ── The four window states, for the worker's notification bookkeeping ───────
-- Not a source of truth for liveness; that stays derived from the timestamps.
CREATE TYPE "ADWINDOWSTATE" AS ENUM ('SCHEDULED', 'LIVE', 'PAUSED', 'ENDED');

-- ── Start boundary ─────────────────────────────────────────────────────────
ALTER TABLE "MerchantAds" ADD COLUMN "startAt" TIMESTAMPTZ(3);
ALTER TABLE "MerchantAds" ADD COLUMN "lastNotifiedState" "ADWINDOWSTATE";

-- ── Move the end boundary to timestamptz ───────────────────────────────────
-- The stored values already are UTC (Prisma normalises on write), so naming
-- that explicitly is exact and non-destructive. Without the USING clause
-- Postgres would reinterpret each value in the session timezone.
ALTER TABLE "MerchantAds"
  ALTER COLUMN "expiresAt" TYPE TIMESTAMPTZ(3)
  USING "expiresAt" AT TIME ZONE 'UTC';

-- ── Store timezone ─────────────────────────────────────────────────────────
-- Defaulted rather than backfilled-then-required: every existing store is in
-- the Philippines, and a default keeps store creation working unchanged until
-- the onboarding form starts collecting it.
ALTER TABLE "StoreLocations" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Asia/Manila';

-- ── Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX "MerchantAds_storeId_startAt_expiresAt_idx"
  ON "MerchantAds"("storeId", "startAt", "expiresAt");

CREATE INDEX "MerchantAds_lastNotifiedState_idx"
  ON "MerchantAds"("lastNotifiedState");

-- ── Seed notification bookkeeping ──────────────────────────────────────────
-- Pre-existing ads are recorded at the state they are already in, so the first
-- worker tick after deploy does not fire a "your promotion is live" notice for
-- every promotion that has been running for weeks.
UPDATE "MerchantAds"
SET "lastNotifiedState" = CASE
  WHEN "expiresAt" IS NOT NULL AND "expiresAt" <= NOW() THEN 'ENDED'::"ADWINDOWSTATE"
  WHEN "isActive" = false                               THEN 'PAUSED'::"ADWINDOWSTATE"
  ELSE                                                       'LIVE'::"ADWINDOWSTATE"
END;
