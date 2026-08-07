-- Extend property moderation statuses.
ALTER TYPE "PROPERTYSTATUS" ADD VALUE 'ACTIVE';
ALTER TYPE "PROPERTYSTATUS" ADD VALUE 'REJECTED';

-- CreateEnum
CREATE TYPE "STOREAPPROVALSTATUS" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED');

-- Add property review metadata.
ALTER TABLE "Properties"
ADD COLUMN "rejectionReason" TEXT,
ADD COLUMN "reviewedAt" TIMESTAMP(3),
ADD COLUMN "reviewedById" TEXT;

-- Add store approval metadata.
ALTER TABLE "Stores"
ADD COLUMN "approvalStatus" "STOREAPPROVALSTATUS" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "rejectionReason" TEXT,
ADD COLUMN "reviewedAt" TIMESTAMP(3),
ADD COLUMN "reviewedById" TEXT;

-- Existing active stores are already approved.
UPDATE "Stores"
SET "approvalStatus" = 'ACTIVE'
WHERE "isActive" = true;

-- Existing properties created by the first House/Lot implementation were
-- submitted through the Done action, so make them reviewable.
UPDATE "Properties"
SET "status" = 'PENDING_REVIEW'
WHERE "status" = 'DRAFT';

-- CreateIndex
CREATE INDEX "Stores_approvalStatus_idx" ON "Stores"("approvalStatus");

-- AddForeignKey
ALTER TABLE "Properties"
ADD CONSTRAINT "Properties_reviewedById_fkey"
FOREIGN KEY ("reviewedById") REFERENCES "Users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stores"
ADD CONSTRAINT "Stores_reviewedById_fkey"
FOREIGN KEY ("reviewedById") REFERENCES "Users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
