-- AlterTable
ALTER TABLE "Sellers" ADD COLUMN     "approvalReason" TEXT,
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ALTER COLUMN "applicationStatus" SET DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "Sellers_applicationStatus_idx" ON "Sellers"("applicationStatus");

-- CreateIndex
CREATE INDEX "Sellers_approvedAt_idx" ON "Sellers"("approvedAt");

-- AddForeignKey
ALTER TABLE "Sellers" ADD CONSTRAINT "Sellers_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "Users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
