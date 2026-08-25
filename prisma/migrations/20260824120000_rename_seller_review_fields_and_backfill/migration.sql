-- Rename the seller review-tracking columns to match the vocabulary the
-- adminApprovals module already uses for stores and properties. The previous
-- names implied approval, but reject writes them too, so a rejected seller
-- read as "approved by <admin>".
ALTER TABLE "Sellers" RENAME COLUMN "approvalReason" TO "rejectionReason";
ALTER TABLE "Sellers" RENAME COLUMN "approvedAt" TO "reviewedAt";
ALTER TABLE "Sellers" RENAME COLUMN "approvedById" TO "reviewedById";

-- Postgres carries the index and FK through a column rename, but keeps their
-- old names. Rename them too so the schema matches what Prisma expects.
ALTER INDEX "Sellers_approvedAt_idx" RENAME TO "Sellers_reviewedAt_idx";
ALTER TABLE "Sellers" RENAME CONSTRAINT "Sellers_approvedById_fkey" TO "Sellers_reviewedById_fkey";

-- Backfill: every seller that exists at this point predates the approval queue
-- and already had working product management. Approval is now enforced on
-- create/update/delete, so without this they would all lose access on deploy.
--
-- reviewedAt / reviewedById are deliberately left NULL: nobody actually
-- reviewed these, and that distinguishes a grandfathered seller from one an
-- admin genuinely approved.
UPDATE "Sellers"
SET "applicationStatus" = 'APPROVED'
WHERE "applicationStatus" = 'PENDING';
