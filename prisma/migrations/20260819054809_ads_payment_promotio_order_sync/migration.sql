/*
  Warnings:

  - `Orders.paymentFeeAmount` is dropped, but its values are copied into
    `paymentProviderFeeAmount` first. No data is lost.

*/
-- CreateEnum
CREATE TYPE "ADGOAL" AS ENUM ('STORE_VISITS', 'IMPRESSIONS', 'PURCHASES');

-- CreateEnum
CREATE TYPE "ADFORMAT" AS ENUM ('MAP_FLOATING_CARD', 'PROMOTED_PIN', 'DISCOVERY_CAROUSEL', 'SPONSORED_SEARCH');

-- CreateEnum
CREATE TYPE "ADSTATUS" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'EXPIRED', 'BUDGET_EXHAUSTED');

-- CreateEnum
CREATE TYPE "ADEVENTTYPE" AS ENUM ('IMPRESSION', 'CLICK', 'CONVERSION');

-- CreateEnum
CREATE TYPE "ORDERCHARGETYPE" AS ENUM ('PRODUCT', 'DISCOUNT', 'BUYER_TRANSACTION_FEE', 'SELLER_MARKETPLACE_FEE', 'PAYMENT_PROCESSING_FEE', 'SHIPPING', 'TAX', 'PROMOTION', 'PLATFORM_SUBSIDY', 'SELLER_SUBSIDY', 'CAMPAIGN', 'REFUND', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "CHARGEPAYER" AS ENUM ('BUYER', 'SELLER', 'PLATFORM');

-- CreateEnum
CREATE TYPE "CHARGEBENEFICIARY" AS ENUM ('BUYER', 'SELLER', 'PLATFORM', 'PAYMENT_PROVIDER', 'COURIER', 'GOVERNMENT');

-- CreateEnum
CREATE TYPE "PROMOTION_FUNDING" AS ENUM ('SELLER', 'PLATFORM', 'SHARED');

-- CreateEnum
CREATE TYPE "PAYMENTFEEPAYER" AS ENUM ('BUYER', 'SELLER', 'PLATFORM', 'SHARED');

-- CreateEnum
CREATE TYPE "PRICINGSTATUS" AS ENUM ('DRAFT', 'ACTIVE', 'SCHEDULED', 'EXPIRED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PRICINGCOMPONENTTYPE" AS ENUM ('BUYER_TRANSACTION_FEE', 'SELLER_MARKETPLACE_FEE', 'PAYMENT_PROCESSING_FEE', 'FIXED_TRANSACTION_FEE', 'WITHDRAWAL_FEE', 'ADVERTISING_FEE');

-- CreateEnum
CREATE TYPE "PRICINGCALCULATIONTYPE" AS ENUM ('PERCENTAGE', 'FIXED', 'PERCENTAGE_AND_FIXED');

-- AlterTable
ALTER TABLE "MerchantAds" ADD COLUMN     "attributedRevenue" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "clicksCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "conversionsCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "dailyBudget" DECIMAL(12,2),
ADD COLUMN     "format" "ADFORMAT" NOT NULL DEFAULT 'MAP_FLOATING_CARD',
ADD COLUMN     "goal" "ADGOAL" NOT NULL DEFAULT 'STORE_VISITS',
ADD COLUMN     "impressionsCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "radiusKm" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "spentAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "targetLat" DOUBLE PRECISION,
ADD COLUMN     "targetLng" DOUBLE PRECISION,
ADD COLUMN     "totalBudget" DECIMAL(12,2),
ALTER COLUMN "kind" SET DEFAULT 'PROMO';

-- AlterTable: add the new fee columns first, so the old value has somewhere to go.
ALTER TABLE "Orders"
ADD COLUMN     "buyerTransactionFeeAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "buyerTransactionFeeRate" DECIMAL(8,5),
ADD COLUMN     "paymentFeePayer" "PAYMENTFEEPAYER" NOT NULL DEFAULT 'BUYER',
ADD COLUMN     "paymentProviderFeeAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "paymentProviderFeeRate" DECIMAL(8,5),
ADD COLUMN     "paymentProviderFixedFee" DECIMAL(12,2),
ADD COLUMN     "sellerMarketplaceFeeAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "sellerMarketplaceFeeRate" DECIMAL(8,5) NOT NULL DEFAULT 0.0200;

-- Carry the retired paymentFeeAmount across to its replacement before dropping
-- it. paymentProviderFeeAmount is the gateway cost the platform incurred, which
-- is what the old single column recorded. Without this the fee history on every
-- existing order is destroyed.
UPDATE "Orders"
SET "paymentProviderFeeAmount" = "paymentFeeAmount"
WHERE "paymentFeeAmount" IS NOT NULL;

-- AlterTable
ALTER TABLE "Orders" DROP COLUMN "paymentFeeAmount";

-- CreateTable
CREATE TABLE "AdEvents" (
    "id" TEXT NOT NULL,
    "adId" TEXT NOT NULL,
    "eventType" "ADEVENTTYPE" NOT NULL,
    "buyerId" TEXT,
    "sessionId" TEXT,
    "orderId" TEXT,
    "revenueAmount" DECIMAL(12,2),
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdEvents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderCharges" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" "ORDERCHARGETYPE" NOT NULL,
    "source" TEXT,
    "description" TEXT,
    "rate" DECIMAL(8,5),
    "amount" DECIMAL(12,2) NOT NULL,
    "payer" "CHARGEPAYER" NOT NULL,
    "beneficiary" "CHARGEBENEFICIARY" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderCharges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingConfigurations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "PRICINGSTATUS" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'PHP',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveUntil" TIMESTAMP(3),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingConfigurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingComponents" (
    "id" TEXT NOT NULL,
    "pricingId" TEXT NOT NULL,
    "type" "PRICINGCOMPONENTTYPE" NOT NULL,
    "calculationType" "PRICINGCALCULATIONTYPE" NOT NULL DEFAULT 'PERCENTAGE',
    "ratePercentage" DECIMAL(7,5),
    "fixedAmount" DECIMAL(12,2),
    "minFee" DECIMAL(12,2),
    "maxFee" DECIMAL(12,2),
    "providerId" TEXT,
    "paymentMethodId" TEXT,
    "sellerPlan" TEXT,
    "categoryId" TEXT,
    "storeId" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingComponents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdEvents_adId_eventType_occurredAt_idx" ON "AdEvents"("adId", "eventType", "occurredAt");

-- CreateIndex
CREATE INDEX "AdEvents_buyerId_idx" ON "AdEvents"("buyerId");

-- CreateIndex
CREATE INDEX "AdEvents_orderId_idx" ON "AdEvents"("orderId");

-- CreateIndex
CREATE INDEX "OrderCharges_orderId_idx" ON "OrderCharges"("orderId");

-- CreateIndex
CREATE INDEX "OrderCharges_type_idx" ON "OrderCharges"("type");

-- CreateIndex
CREATE INDEX "OrderCharges_payer_idx" ON "OrderCharges"("payer");

-- CreateIndex
CREATE INDEX "OrderCharges_beneficiary_idx" ON "OrderCharges"("beneficiary");

-- CreateIndex
CREATE INDEX "PricingConfigurations_status_idx" ON "PricingConfigurations"("status");

-- CreateIndex
CREATE INDEX "PricingConfigurations_effectiveFrom_effectiveUntil_idx" ON "PricingConfigurations"("effectiveFrom", "effectiveUntil");

-- CreateIndex
CREATE INDEX "PricingComponents_pricingId_idx" ON "PricingComponents"("pricingId");

-- CreateIndex
CREATE INDEX "PricingComponents_type_isActive_priority_idx" ON "PricingComponents"("type", "isActive", "priority");

-- CreateIndex
CREATE INDEX "PricingComponents_providerId_idx" ON "PricingComponents"("providerId");

-- CreateIndex
CREATE INDEX "PricingComponents_paymentMethodId_idx" ON "PricingComponents"("paymentMethodId");

-- CreateIndex
CREATE INDEX "PricingComponents_categoryId_idx" ON "PricingComponents"("categoryId");

-- CreateIndex
CREATE INDEX "PricingComponents_storeId_idx" ON "PricingComponents"("storeId");

-- CreateIndex
CREATE INDEX "CartItems_variantId_idx" ON "CartItems"("variantId");

-- CreateIndex
CREATE INDEX "MerchantAdProducts_variantId_idx" ON "MerchantAdProducts"("variantId");

-- CreateIndex
CREATE INDEX "MerchantAds_radiusKm_idx" ON "MerchantAds"("radiusKm");

-- CreateIndex
CREATE INDEX "MerchantAds_expiresAt_idx" ON "MerchantAds"("expiresAt");

-- CreateIndex
CREATE INDEX "ProductReviews_orderId_idx" ON "ProductReviews"("orderId");

-- CreateIndex
CREATE INDEX "WishlistItems_productId_idx" ON "WishlistItems"("productId");

-- CreateIndex
CREATE INDEX "WishlistItems_variantId_idx" ON "WishlistItems"("variantId");

-- AddForeignKey
ALTER TABLE "AdEvents" ADD CONSTRAINT "AdEvents_adId_fkey" FOREIGN KEY ("adId") REFERENCES "MerchantAds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderCharges" ADD CONSTRAINT "OrderCharges_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingComponents" ADD CONSTRAINT "PricingComponents_pricingId_fkey" FOREIGN KEY ("pricingId") REFERENCES "PricingConfigurations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingComponents" ADD CONSTRAINT "PricingComponents_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "PaymentProviders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingComponents" ADD CONSTRAINT "PricingComponents_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingComponents" ADD CONSTRAINT "PricingComponents_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
