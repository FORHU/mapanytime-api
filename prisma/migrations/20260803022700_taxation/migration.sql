/*
  Warnings:

  - You are about to drop the column `userId` on the `AuditLogs` table. All the data in the column will be lost.
  - You are about to drop the column `isRead` on the `Notifications` table. All the data in the column will be lost.
  - You are about to drop the column `closeTime` on the `StoreHours` table. All the data in the column will be lost.
  - You are about to drop the column `openTime` on the `StoreHours` table. All the data in the column will be lost.
  - You are about to drop the column `avatarId` on the `Users` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[parentId,name]` on the table `Categories` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[productId,variantId,isPrimary]` on the table `ProductImages` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[storeId,dayOfWeek]` on the table `StoreHours` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[avatarFileId]` on the table `Users` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `closeMinutes` to the `StoreHours` table without a default value. This is not possible if the table is not empty.
  - Added the required column `openMinutes` to the `StoreHours` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "RESERVATIONSTATUS" AS ENUM ('RESERVED', 'CONSUMED', 'EXPIRED', 'RELEASED');

-- CreateEnum
CREATE TYPE "INVENTORYREFERENCETYPE" AS ENUM ('ORDER', 'RETURN', 'TRANSFER', 'RESTOCK', 'MANUAL_ADJUSTMENT');

-- DropForeignKey
ALTER TABLE "Inventory" DROP CONSTRAINT "Inventory_productId_fkey";

-- DropForeignKey
ALTER TABLE "InventoryMovements" DROP CONSTRAINT "InventoryMovements_productId_fkey";

-- DropForeignKey
ALTER TABLE "Users" DROP CONSTRAINT "Users_avatarId_fkey";

-- DropIndex
DROP INDEX "AuditLogs_userId_idx";

-- DropIndex
DROP INDEX "Notifications_isRead_idx";

-- DropIndex
DROP INDEX "Users_avatarId_key";

-- AlterTable
ALTER TABLE "AuditLogs" DROP COLUMN "userId",
ADD COLUMN     "performedById" TEXT,
ADD COLUMN     "requestId" TEXT,
ADD COLUMN     "userAgent" TEXT;

-- AlterTable
ALTER TABLE "Files" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Inventory" ALTER COLUMN "productId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "InventoryMovements" ADD COLUMN     "referenceType" "INVENTORYREFERENCETYPE",
ALTER COLUMN "productId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Notifications" DROP COLUMN "isRead";

-- AlterTable
ALTER TABLE "Orders" ADD COLUMN     "sellerPhoneSnapshot" TEXT,
ADD COLUMN     "storeAddressSnapshot" TEXT,
ADD COLUMN     "storeEmailSnapshot" TEXT;

-- AlterTable
ALTER TABLE "StoreHours" DROP COLUMN "closeTime",
DROP COLUMN "openTime",
ADD COLUMN     "closeMinutes" INTEGER NOT NULL,
ADD COLUMN     "openMinutes" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "Users" DROP COLUMN "avatarId",
ADD COLUMN     "avatarFileId" TEXT;

-- CreateTable
CREATE TABLE "InventoryReservations" (
    "id" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "cartId" TEXT,
    "orderId" TEXT,
    "quantity" INTEGER NOT NULL,
    "status" "RESERVATIONSTATUS" NOT NULL DEFAULT 'RESERVED',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryReservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryReservations_inventoryId_status_idx" ON "InventoryReservations"("inventoryId", "status");

-- CreateIndex
CREATE INDEX "InventoryReservations_expiresAt_status_idx" ON "InventoryReservations"("expiresAt", "status");

-- CreateIndex
CREATE INDEX "InventoryReservations_buyerId_status_idx" ON "InventoryReservations"("buyerId", "status");

-- CreateIndex
CREATE INDEX "InventoryReservations_orderId_idx" ON "InventoryReservations"("orderId");

-- CreateIndex
CREATE INDEX "InventoryReservations_cartId_idx" ON "InventoryReservations"("cartId");

-- CreateIndex
CREATE INDEX "AuditLogs_performedById_idx" ON "AuditLogs"("performedById");

-- CreateIndex
CREATE INDEX "AuditLogs_requestId_idx" ON "AuditLogs"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "Categories_parentId_name_key" ON "Categories"("parentId", "name");

-- CreateIndex
CREATE INDEX "Notifications_readAt_idx" ON "Notifications"("readAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductImages_productId_variantId_isPrimary_key" ON "ProductImages"("productId", "variantId", "isPrimary");

-- CreateIndex
CREATE UNIQUE INDEX "StoreHours_storeId_dayOfWeek_key" ON "StoreHours"("storeId", "dayOfWeek");

-- CreateIndex
CREATE UNIQUE INDEX "Users_avatarFileId_key" ON "Users"("avatarFileId");

-- AddForeignKey
ALTER TABLE "Users" ADD CONSTRAINT "Users_avatarFileId_fkey" FOREIGN KEY ("avatarFileId") REFERENCES "Files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryReservations" ADD CONSTRAINT "InventoryReservations_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "Inventory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryReservations" ADD CONSTRAINT "InventoryReservations_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryReservations" ADD CONSTRAINT "InventoryReservations_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Carts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryReservations" ADD CONSTRAINT "InventoryReservations_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovements" ADD CONSTRAINT "InventoryMovements_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
