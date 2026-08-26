-- CreateEnum
CREATE TYPE "REWARDTRANSACTIONTYPE" AS ENUM ('EARN', 'SPEND', 'BONUS', 'REFUND', 'EXPIRED', 'REVERSAL', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "REWARDDISCOUNTTYPE" AS ENUM ('FIXED', 'PERCENTAGE');

-- CreateEnum
CREATE TYPE "USERVOUCHERSTATUS" AS ENUM ('ACTIVE', 'USED', 'EXPIRED');

-- AlterTable
ALTER TABLE "Orders" ADD COLUMN     "voucherAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "RewardWallet" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "lifetimeEarned" INTEGER NOT NULL DEFAULT 0,
    "lifetimeSpent" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardTransactions" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "type" "REWARDTRANSACTIONTYPE" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "orderId" TEXT,
    "userVoucherId" TEXT,
    "referenceKey" TEXT,
    "source" TEXT,
    "description" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardTransactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardConfigurations" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "earnRatePhpPerPoint" DECIMAL(10,2) NOT NULL DEFAULT 100.00,
    "pointValueInPhp" DECIMAL(10,4) NOT NULL DEFAULT 0.10,
    "expirationMonths" INTEGER NOT NULL DEFAULT 12,
    "isEarningActive" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "updatedById" TEXT,
    "changeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardConfigurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardVouchers" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "pointCost" INTEGER NOT NULL,
    "discountType" "REWARDDISCOUNTTYPE" NOT NULL,
    "discountValue" DECIMAL(12,2) NOT NULL,
    "minOrderAmount" DECIMAL(12,2),
    "maxDiscountAmount" DECIMAL(12,2),
    "validityDays" INTEGER NOT NULL DEFAULT 30,
    "totalStock" INTEGER,
    "claimedCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardVouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserVouchers" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "status" "USERVOUCHERSTATUS" NOT NULL DEFAULT 'ACTIVE',
    "pointsSpent" INTEGER NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "orderId" TEXT,

    CONSTRAINT "UserVouchers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RewardWallet_buyerId_key" ON "RewardWallet"("buyerId");

-- CreateIndex
CREATE INDEX "RewardWallet_buyerId_idx" ON "RewardWallet"("buyerId");

-- CreateIndex
CREATE UNIQUE INDEX "RewardTransactions_referenceKey_key" ON "RewardTransactions"("referenceKey");

-- CreateIndex
CREATE INDEX "RewardTransactions_walletId_createdAt_idx" ON "RewardTransactions"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "RewardTransactions_orderId_idx" ON "RewardTransactions"("orderId");

-- CreateIndex
CREATE INDEX "RewardTransactions_type_idx" ON "RewardTransactions"("type");

-- CreateIndex
CREATE INDEX "RewardTransactions_expiresAt_idx" ON "RewardTransactions"("expiresAt");

-- CreateIndex
CREATE INDEX "RewardConfigurations_isActive_idx" ON "RewardConfigurations"("isActive");

-- CreateIndex
CREATE INDEX "RewardVouchers_isActive_idx" ON "RewardVouchers"("isActive");

-- CreateIndex
CREATE INDEX "UserVouchers_buyerId_status_idx" ON "UserVouchers"("buyerId", "status");

-- CreateIndex
CREATE INDEX "UserVouchers_voucherId_idx" ON "UserVouchers"("voucherId");

-- CreateIndex
CREATE INDEX "UserVouchers_orderId_idx" ON "UserVouchers"("orderId");

-- CreateIndex
CREATE INDEX "UserVouchers_status_expiresAt_idx" ON "UserVouchers"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "RewardWallet" ADD CONSTRAINT "RewardWallet_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardTransactions" ADD CONSTRAINT "RewardTransactions_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "RewardWallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserVouchers" ADD CONSTRAINT "UserVouchers_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserVouchers" ADD CONSTRAINT "UserVouchers_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "RewardVouchers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserVouchers" ADD CONSTRAINT "UserVouchers_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CheckConstraint (F50, see OPEN-FLAGS.md): a wallet balance must never go
-- negative. Enforced at the database level, not just in application code.
ALTER TABLE "RewardWallet" ADD CONSTRAINT "reward_wallet_balance_nonnegative" CHECK ("balance" >= 0);
