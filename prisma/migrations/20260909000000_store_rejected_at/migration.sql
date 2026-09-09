-- The anchor for the 24-hour rejected-store deletion window.
--
-- Deliberately a new column rather than a reuse of "reviewedAt": every terminal
-- transition writes that one, so an approval or a revision request would re-date
-- a window that belongs to the rejection alone.

ALTER TABLE "Stores" ADD COLUMN "rejectedAt" TIMESTAMP(3);

-- Backfill to NOW(), not to "reviewedAt". Backfilling the real rejection time
-- would put every pre-existing REJECTED store past its window immediately, and
-- the first sweep after deploy would remove the lot without any seller ever
-- having seen the countdown. One fresh window each instead.
UPDATE "Stores"
SET "rejectedAt" = NOW()
WHERE "approvalStatus" = 'REJECTED' AND "deletedAt" IS NULL;

-- The sweep's only query: REJECTED rows past their window.
CREATE INDEX "Stores_approvalStatus_rejectedAt_idx" ON "Stores"("approvalStatus", "rejectedAt");
