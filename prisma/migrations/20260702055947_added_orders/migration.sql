/*
  Warnings:

  - The `status` column on the `AdminInvites` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `accountStatus` column on the `Users` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Changed the type of `documentType` on the `Documents` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "USERACCOUNTSTATUS" AS ENUM ('ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "DOCUMENTTYPES" AS ENUM ('MAYORS_PERMIT', 'TIN_ID', 'DTI_CERTIFICATE', 'GOV_ID');

-- CreateEnum
CREATE TYPE "INVITESTATUS" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "FULLFILLMENTTYPE" AS ENUM ('DELIVERY', 'PICKUP');

-- CreateEnum
CREATE TYPE "ORDERSTATUS" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "PAYMENTMETHOD" AS ENUM ('BANK', 'GCASH', 'CASH_ON_DELIVERY');

-- CreateEnum
CREATE TYPE "PAYMENTSTATUS" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED');

-- AlterTable
ALTER TABLE "AdminInvites" DROP COLUMN "status",
ADD COLUMN     "status" "INVITESTATUS" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "Documents" DROP COLUMN "documentType",
ADD COLUMN     "documentType" "DOCUMENTTYPES" NOT NULL;

-- AlterTable
ALTER TABLE "Users" DROP COLUMN "accountStatus",
ADD COLUMN     "accountStatus" "USERACCOUNTSTATUS" NOT NULL DEFAULT 'ACTIVE';

-- DropEnum
DROP TYPE "CategoryStatus";

-- DropEnum
DROP TYPE "DocumentTypes";

-- DropEnum
DROP TYPE "InviteStatus";

-- DropEnum
DROP TYPE "UserAccountStatus";

-- CreateTable
CREATE TABLE "Orders" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "type" "FULLFILLMENTTYPE" NOT NULL DEFAULT 'PICKUP',
    "status" "ORDERSTATUS" NOT NULL DEFAULT 'PENDING',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItems" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderItems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payments" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paymentMethod" "PAYMENTMETHOD" NOT NULL,
    "status" "PAYMENTSTATUS" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Users_accountStatus_idx" ON "Users"("accountStatus");

-- AddForeignKey
ALTER TABLE "StoreReviews" ADD CONSTRAINT "StoreReviews_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Orders" ADD CONSTRAINT "Orders_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Orders" ADD CONSTRAINT "Orders_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItems" ADD CONSTRAINT "OrderItems_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payments" ADD CONSTRAINT "Payments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
