-- Analytics PAGE_VIEW + the two InventoryReservations indexes
--
-- Split out of 20260818T000000_payments_provider_registry on purpose. That
-- migration cannot run on a database where `prisma db push` already applied the
-- payments rework, but these two changes still need to reach it — the local dev
-- database has the payments tables yet has neither PAGE_VIEW nor the indexes.
--
-- Every statement is idempotent, so this is safe on a fresh database (where the
-- indexes already exist from the original InventoryReservations migration) and
-- on a db-pushed one alike.

-- The web page-view tracker posts eventType 'PAGE_VIEW'; without this the
-- ingestion endpoint passes Joi and then dies in Postgres with 22P02.
-- See docs/payments-rework-review.md §9.
ALTER TYPE "ANALYTICSEVENTTYPE" ADD VALUE IF NOT EXISTS 'PAGE_VIEW' BEFORE 'STORE_VIEW';

-- Dropped from schema.prisma by the payments rework, but both still back live
-- queries: the reservation TTL sweep filters on (status, expiresAt) and
-- findActiveReservationsByBuyer on (buyerId, status, expiresAt).
-- See docs/payments-rework-review.md §11.
CREATE INDEX IF NOT EXISTS "InventoryReservations_expiresAt_status_idx" ON "InventoryReservations"("expiresAt", "status");
CREATE INDEX IF NOT EXISTS "InventoryReservations_buyerId_status_idx"   ON "InventoryReservations"("buyerId", "status");
