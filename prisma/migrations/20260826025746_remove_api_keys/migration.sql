/*
  Warnings:

  - You are about to drop the `ApiKeys` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "ApiKeys" DROP CONSTRAINT "ApiKeys_userId_fkey";

-- DropTable
DROP TABLE "ApiKeys";
