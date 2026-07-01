/*
  Warnings:

  - You are about to drop the column `requestedById` on the `Categories` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `Categories` table. All the data in the column will be lost.
  - You are about to drop the column `storeId` on the `Categories` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[name]` on the table `Categories` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "Categories" DROP CONSTRAINT "Categories_storeId_fkey";

-- DropIndex
DROP INDEX "Categories_name_storeId_key";

-- AlterTable
ALTER TABLE "Categories" DROP COLUMN "requestedById",
DROP COLUMN "status",
DROP COLUMN "storeId",
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "parentId" TEXT;

-- CreateTable
CREATE TABLE "_CategoriesToStores" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_CategoriesToStores_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_CategoriesToStores_B_index" ON "_CategoriesToStores"("B");

-- CreateIndex
CREATE UNIQUE INDEX "Categories_name_key" ON "Categories"("name");

-- CreateIndex
CREATE INDEX "Categories_parentId_idx" ON "Categories"("parentId");

-- CreateIndex
CREATE INDEX "Categories_name_idx" ON "Categories"("name");

-- CreateIndex
CREATE INDEX "Products_storeId_idx" ON "Products"("storeId");

-- CreateIndex
CREATE INDEX "Products_categoryId_idx" ON "Products"("categoryId");

-- CreateIndex
CREATE INDEX "Products_isActive_idx" ON "Products"("isActive");

-- CreateIndex
CREATE INDEX "Stores_sellerId_idx" ON "Stores"("sellerId");

-- CreateIndex
CREATE INDEX "Users_email_idx" ON "Users"("email");

-- CreateIndex
CREATE INDEX "Users_accountStatus_idx" ON "Users"("accountStatus");

-- AddForeignKey
ALTER TABLE "Categories" ADD CONSTRAINT "Categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CategoriesToStores" ADD CONSTRAINT "_CategoriesToStores_A_fkey" FOREIGN KEY ("A") REFERENCES "Categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CategoriesToStores" ADD CONSTRAINT "_CategoriesToStores_B_fkey" FOREIGN KEY ("B") REFERENCES "Stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
