-- CreateEnum
CREATE TYPE "MARKETINGTRANSACTIONTYPE" AS ENUM ('DEPOSIT', 'AD_SPEND', 'REFUND', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE IF NOT EXISTS "MarketingWallet" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "lifetimeDeposited" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "lifetimeSpent" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'PHP',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MarketingWalletTransactions" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "type" "MARKETINGTRANSACTIONTYPE" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "balanceAfter" DECIMAL(12,2) NOT NULL,
    "adId" TEXT,
    "referenceKey" TEXT,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingWalletTransactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MarketingWallet_sellerId_key" ON "MarketingWallet"("sellerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MarketingWallet_sellerId_idx" ON "MarketingWallet"("sellerId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MarketingWalletTransactions_referenceKey_key" ON "MarketingWalletTransactions"("referenceKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MarketingWalletTransactions_walletId_createdAt_idx" ON "MarketingWalletTransactions"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MarketingWalletTransactions_adId_idx" ON "MarketingWalletTransactions"("adId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MarketingWalletTransactions_type_idx" ON "MarketingWalletTransactions"("type");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MarketingWallet_sellerId_fkey'
  ) THEN
    ALTER TABLE "MarketingWallet" ADD CONSTRAINT "MarketingWallet_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MarketingWalletTransactions_walletId_fkey'
  ) THEN
    ALTER TABLE "MarketingWalletTransactions" ADD CONSTRAINT "MarketingWalletTransactions_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "MarketingWallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MarketingWalletTransactions_adId_fkey'
  ) THEN
    ALTER TABLE "MarketingWalletTransactions" ADD CONSTRAINT "MarketingWalletTransactions_adId_fkey" FOREIGN KEY ("adId") REFERENCES "MerchantAds"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
