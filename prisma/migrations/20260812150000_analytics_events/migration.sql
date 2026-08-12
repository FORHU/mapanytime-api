-- CreateEnum
CREATE TYPE "ANALYTICSEVENTTYPE" AS ENUM ('STORE_VIEW', 'PRODUCT_VIEW', 'PRODUCT_CLICK', 'SEARCH', 'ADD_TO_CART', 'ADD_TO_WISHLIST', 'CHECKOUT_STARTED', 'ORDER_COMPLETED');

-- CreateTable
CREATE TABLE "AnalyticsEvents" (
    "id" TEXT NOT NULL,
    "eventType" "ANALYTICSEVENTTYPE" NOT NULL,
    "userId" TEXT,
    "sessionId" TEXT,
    "storeId" TEXT,
    "productId" TEXT,
    "categoryId" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalyticsEvents_eventType_occurredAt_idx" ON "AnalyticsEvents"("eventType", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvents_storeId_occurredAt_idx" ON "AnalyticsEvents"("storeId", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvents_productId_occurredAt_idx" ON "AnalyticsEvents"("productId", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvents_categoryId_occurredAt_idx" ON "AnalyticsEvents"("categoryId", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvents_sessionId_occurredAt_idx" ON "AnalyticsEvents"("sessionId", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvents_userId_occurredAt_idx" ON "AnalyticsEvents"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvents_occurredAt_idx" ON "AnalyticsEvents"("occurredAt");
