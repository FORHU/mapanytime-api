-- Columns supporting the widened store approval lifecycle.
--
-- Separate from 20260908000000_store_review_statuses because that migration
-- adds the enum values, and Postgres will not let a transaction use a value it
-- added itself.

ALTER TABLE "Stores"
  ADD COLUMN "revisionNotes"      TEXT,
  ADD COLUMN "reviewClaimedById"  TEXT,
  ADD COLUMN "reviewClaimedAt"    TIMESTAMP(3),
  ADD COLUMN "lastSubmittedAt"    TIMESTAMP(3),
  ADD COLUMN "activeBeforeReview" BOOLEAN;

-- Existing stores have all been submitted at least once; without this their
-- queue position would sort as NULL forever.
UPDATE "Stores" SET "lastSubmittedAt" = "createdAt" WHERE "lastSubmittedAt" IS NULL;

ALTER TABLE "Stores"
  ADD CONSTRAINT "Stores_reviewClaimedById_fkey"
  FOREIGN KEY ("reviewClaimedById") REFERENCES "Users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Re-added: dropped by 20260807052331_house_lot_metadata, and the admin queue
-- filters on it on every load.
CREATE INDEX "Stores_approvalStatus_idx" ON "Stores"("approvalStatus");
CREATE INDEX "Stores_reviewClaimedById_idx" ON "Stores"("reviewClaimedById");
