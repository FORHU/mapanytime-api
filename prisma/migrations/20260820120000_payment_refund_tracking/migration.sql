-- AlterTable
ALTER TABLE "Payments" ADD COLUMN     "refundReference" TEXT,
ADD COLUMN     "refundedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "refundedAt" TIMESTAMP(3);
