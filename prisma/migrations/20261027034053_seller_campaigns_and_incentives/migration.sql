-- CreateEnum
CREATE TYPE "SELLERCAMPAIGNTYPE" AS ENUM ('BONUS_POINTS', 'DOUBLE_POINTS', 'PRODUCT_BOOST');

-- CreateEnum
CREATE TYPE "CAMPAIGNSTATUS" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'EXHAUSTED');

-- CreateTable
CREATE TABLE "SellerCampaigns" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "storeId" TEXT,
    "name" TEXT NOT NULL,
    "type" "SELLERCAMPAIGNTYPE" NOT NULL DEFAULT 'BONUS_POINTS',
    "status" "CAMPAIGNSTATUS" NOT NULL DEFAULT 'DRAFT',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "budgetAmount" DECIMAL(12,2) NOT NULL,
    "spentAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "bonusPoints" INTEGER,
    "maxRewardPoints" INTEGER,
    "minOrderAmount" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellerCampaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellerCampaignTransactions" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "pointsGranted" INTEGER NOT NULL,
    "sellerCost" DECIMAL(12,2) NOT NULL,
    "referenceKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SellerCampaignTransactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SellerCampaigns_sellerId_idx" ON "SellerCampaigns"("sellerId");

-- CreateIndex
CREATE INDEX "SellerCampaigns_storeId_idx" ON "SellerCampaigns"("storeId");

-- CreateIndex
CREATE INDEX "SellerCampaigns_status_idx" ON "SellerCampaigns"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SellerCampaignTransactions_referenceKey_key" ON "SellerCampaignTransactions"("referenceKey");

-- CreateIndex
CREATE INDEX "SellerCampaignTransactions_campaignId_idx" ON "SellerCampaignTransactions"("campaignId");

-- CreateIndex
CREATE INDEX "SellerCampaignTransactions_sellerId_idx" ON "SellerCampaignTransactions"("sellerId");

-- CreateIndex
CREATE INDEX "SellerCampaignTransactions_orderId_idx" ON "SellerCampaignTransactions"("orderId");

-- AddForeignKey
ALTER TABLE "SellerCampaigns" ADD CONSTRAINT "SellerCampaigns_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerCampaigns" ADD CONSTRAINT "SellerCampaigns_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerCampaignTransactions" ADD CONSTRAINT "SellerCampaignTransactions_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "SellerCampaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerCampaignTransactions" ADD CONSTRAINT "SellerCampaignTransactions_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerCampaignTransactions" ADD CONSTRAINT "SellerCampaignTransactions_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
