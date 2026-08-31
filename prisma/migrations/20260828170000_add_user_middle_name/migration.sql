-- Registration now collects an optional middle name alongside the required
-- first/last name, matching how identity is modeled everywhere else on
-- Users (firstName/lastName as separate nullable columns, not a combined
-- name field). Nullable with no default: existing rows are unaffected.

ALTER TABLE "Users" ADD COLUMN "middleName" TEXT;
