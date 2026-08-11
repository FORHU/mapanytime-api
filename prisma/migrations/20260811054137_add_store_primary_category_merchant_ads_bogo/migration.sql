-- CreateEnum
CREATE TYPE "MERCHANTADKIND" AS ENUM ('PROMO', 'JOB', 'EVENT');

-- AlterTable
ALTER TABLE "OrderItems" ADD COLUMN     "appliedAdId" TEXT,
ADD COLUMN     "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Stores" ADD COLUMN     "primaryCategoryId" TEXT;

-- CreateTable
CREATE TABLE "MerchantAds" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "kind" "MERCHANTADKIND" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "imageUrl" TEXT,
    "badgeLabel" TEXT,
    "ctaLabel" TEXT,
    "salaryLabel" TEXT,
    "buyQuantity" INTEGER,
    "freeQuantity" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantAds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantAdProducts" (
    "id" TEXT NOT NULL,
    "adId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,

    CONSTRAINT "MerchantAdProducts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MerchantAds_storeId_isActive_idx" ON "MerchantAds"("storeId", "isActive");

-- CreateIndex
CREATE INDEX "MerchantAdProducts_productId_idx" ON "MerchantAdProducts"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantAdProducts_adId_productId_variantId_key" ON "MerchantAdProducts"("adId", "productId", "variantId");

-- CreateIndex
CREATE INDEX "OrderItems_appliedAdId_idx" ON "OrderItems"("appliedAdId");

-- CreateIndex
CREATE INDEX "Stores_primaryCategoryId_idx" ON "Stores"("primaryCategoryId");

-- AddForeignKey
ALTER TABLE "Stores" ADD CONSTRAINT "Stores_primaryCategoryId_fkey" FOREIGN KEY ("primaryCategoryId") REFERENCES "Categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantAds" ADD CONSTRAINT "MerchantAds_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantAdProducts" ADD CONSTRAINT "MerchantAdProducts_adId_fkey" FOREIGN KEY ("adId") REFERENCES "MerchantAds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantAdProducts" ADD CONSTRAINT "MerchantAdProducts_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantAdProducts" ADD CONSTRAINT "MerchantAdProducts_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItems" ADD CONSTRAINT "OrderItems_appliedAdId_fkey" FOREIGN KEY ("appliedAdId") REFERENCES "MerchantAds"("id") ON DELETE SET NULL ON UPDATE CASCADE;
