-- Widen the store approval lifecycle from 3 statuses to 5.
--
-- Deliberately alone in its own migration. Postgres refuses to use a newly
-- added enum value in the same transaction that added it, and Prisma wraps each
-- migration in one — so the columns, the backfill and anything that writes
-- 'UNDER_REVIEW' or 'NEEDS_REVISION' must land in a later migration.
-- See 20260908000001_store_review_workflow_columns.
--
-- No backfill is needed here: every existing row already holds PENDING, ACTIVE
-- or REJECTED, and all three survive unchanged.

ALTER TYPE "STOREAPPROVALSTATUS" ADD VALUE 'UNDER_REVIEW' AFTER 'PENDING';
ALTER TYPE "STOREAPPROVALSTATUS" ADD VALUE 'NEEDS_REVISION' AFTER 'UNDER_REVIEW';
