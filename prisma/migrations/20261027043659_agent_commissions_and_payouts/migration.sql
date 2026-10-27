-- CreateEnum
CREATE TYPE "AGENTCOMMISSIONTYPE" AS ENUM ('SALE_COMMISSION', 'RECRUITMENT_BONUS', 'COMMISSION_REVERSAL', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "COMMISSIONSTATUS" AS ENUM ('PENDING', 'MATURED', 'CANCELLED', 'PAID');

-- CreateEnum
CREATE TYPE "COMMISSIONBASE" AS ENUM ('GMV', 'MARKETPLACE_FEE', 'NET_PLATFORM_REVENUE');

-- CreateTable
CREATE TABLE "AgentCommissionAccount" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "availableBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "pendingBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "lifetimeEarned" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "lifetimePaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentCommissionAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentCommissionTransactions" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" "AGENTCOMMISSIONTYPE" NOT NULL,
    "status" "COMMISSIONSTATUS" NOT NULL DEFAULT 'PENDING',
    "commissionRate" DECIMAL(8,5) NOT NULL,
    "commissionBase" "COMMISSIONBASE" NOT NULL DEFAULT 'GMV',
    "baseAmount" DECIMAL(12,2) NOT NULL,
    "commissionAmount" DECIMAL(12,2) NOT NULL,
    "balanceAfter" DECIMAL(12,2) NOT NULL,
    "referenceKey" TEXT,
    "description" TEXT,
    "maturesAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentCommissionTransactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentCommissionConfigurations" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "commissionRate" DECIMAL(8,5) NOT NULL DEFAULT 0.00050,
    "commissionBase" "COMMISSIONBASE" NOT NULL DEFAULT 'GMV',
    "eligibilityHoldDays" INTEGER NOT NULL DEFAULT 7,
    "payoutMinimum" DECIMAL(12,2) NOT NULL DEFAULT 500.00,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "updatedById" TEXT,
    "changeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentCommissionConfigurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentPayouts" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "PAYOUTSTATUS" NOT NULL DEFAULT 'PENDING',
    "paymentMethod" TEXT NOT NULL DEFAULT 'BANK_TRANSFER',
    "reference" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentPayouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentCommissionAccount_agentId_key" ON "AgentCommissionAccount"("agentId");

-- CreateIndex
CREATE INDEX "AgentCommissionAccount_agentId_idx" ON "AgentCommissionAccount"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentCommissionTransactions_referenceKey_key" ON "AgentCommissionTransactions"("referenceKey");

-- CreateIndex
CREATE INDEX "AgentCommissionTransactions_accountId_createdAt_idx" ON "AgentCommissionTransactions"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentCommissionTransactions_agentId_idx" ON "AgentCommissionTransactions"("agentId");

-- CreateIndex
CREATE INDEX "AgentCommissionTransactions_sellerId_idx" ON "AgentCommissionTransactions"("sellerId");

-- CreateIndex
CREATE INDEX "AgentCommissionTransactions_orderId_idx" ON "AgentCommissionTransactions"("orderId");

-- CreateIndex
CREATE INDEX "AgentCommissionTransactions_status_idx" ON "AgentCommissionTransactions"("status");

-- CreateIndex
CREATE INDEX "AgentCommissionConfigurations_isActive_idx" ON "AgentCommissionConfigurations"("isActive");

-- CreateIndex
CREATE INDEX "AgentPayouts_agentId_idx" ON "AgentPayouts"("agentId");

-- CreateIndex
CREATE INDEX "AgentPayouts_status_idx" ON "AgentPayouts"("status");

-- AddForeignKey
ALTER TABLE "AgentCommissionAccount" ADD CONSTRAINT "AgentCommissionAccount_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCommissionTransactions" ADD CONSTRAINT "AgentCommissionTransactions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "AgentCommissionAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCommissionTransactions" ADD CONSTRAINT "AgentCommissionTransactions_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCommissionTransactions" ADD CONSTRAINT "AgentCommissionTransactions_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentPayouts" ADD CONSTRAINT "AgentPayouts_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "AgentCommissionAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentPayouts" ADD CONSTRAINT "AgentPayouts_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
