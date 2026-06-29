/*
  Warnings:

  - A unique constraint covering the columns `[name,storeId]` on the table `Categories` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `storeId` to the `Categories` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Categories_name_key";

-- AlterTable
ALTER TABLE "Categories" ADD COLUMN     "storeId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Categories_name_storeId_key" ON "Categories"("name", "storeId");

-- AddForeignKey
ALTER TABLE "Categories" ADD CONSTRAINT "Categories_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
