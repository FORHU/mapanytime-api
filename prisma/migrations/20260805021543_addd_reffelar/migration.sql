/*
  Warnings:

  - A unique constraint covering the columns `[userReferralId]` on the table `Users` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[userReferralId,id]` on the table `Users` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "USERACCOUNTSTATUS" ADD VALUE 'PENDING_VERIFICATION';
ALTER TYPE "USERACCOUNTSTATUS" ADD VALUE 'UNDER_REVIEW';
ALTER TYPE "USERACCOUNTSTATUS" ADD VALUE 'BANNED';
ALTER TYPE "USERACCOUNTSTATUS" ADD VALUE 'NEED_REVISSION';

-- AlterTable
ALTER TABLE "Users" ADD COLUMN     "userReferralId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Users_userReferralId_key" ON "Users"("userReferralId");

-- CreateIndex
CREATE INDEX "Users_userReferralId_idx" ON "Users"("userReferralId");

-- CreateIndex
CREATE UNIQUE INDEX "Users_userReferralId_id_key" ON "Users"("userReferralId", "id");

-- AddForeignKey
ALTER TABLE "Users" ADD CONSTRAINT "Users_userReferralId_fkey" FOREIGN KEY ("userReferralId") REFERENCES "Users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
