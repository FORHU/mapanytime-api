-- Adds the MANAGER org role and a per-member feature permission list.
--
-- Postgres forbids using a newly added enum value in the same transaction that
-- adds it, so nothing below may reference 'MANAGER'. The backfill only touches
-- SELLER_USER rows, which is safe.

-- AlterEnum
ALTER TYPE "SellerOrgRole" ADD VALUE 'MANAGER';

-- AlterTable
ALTER TABLE "SellerOrganizationMembers"
  ADD COLUMN "permissions" TEXT[] NOT NULL DEFAULT '{}';

-- Existing staff keep exactly what they can reach today, written explicitly so
-- the column is never ambiguous. SELLER_ADMIN rows stay '{}' — admins hold
-- every feature implicitly and their stored list is deliberately ignored.
UPDATE "SellerOrganizationMembers"
   SET "permissions" = ARRAY['orders', 'products']
 WHERE "role" = 'SELLER_USER';
