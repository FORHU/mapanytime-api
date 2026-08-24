/*
  Warnings:

  - Changed the type of `name` on the `Tags` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "PRODUCTTAG" AS ENUM ('NEW_ARRIVAL', 'POPULAR', 'LIMITED_EDITION', 'BEST_SELLER', 'TRENDING', 'ORGANIC', 'SEASONAL', 'VEGAN', 'USED');

-- Handle NULL values: delete rows with NULL names since they're invalid
DELETE FROM "Tags" WHERE "name" IS NULL;

-- AlterTable
ALTER TABLE "Tags" DROP COLUMN "name",
ADD COLUMN     "name" "PRODUCTTAG" NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Tags_name_key" ON "Tags"("name");
