/*
  Warnings:

  - You are about to drop the column `taxAmount` on the `Orders` table. All the data in the column will be lost.
  - You are about to drop the `CommissionRules` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE IF EXISTS "CommissionRules" DROP CONSTRAINT IF EXISTS "CommissionRules_categoryId_fkey";

-- AlterTable
ALTER TABLE "Orders" DROP COLUMN IF EXISTS "taxAmount";

-- DropTable
DROP TABLE IF EXISTS "CommissionRules";
