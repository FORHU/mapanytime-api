-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DOCUMENTTYPES" ADD VALUE 'BIR_CERTIFICATE';
ALTER TYPE "DOCUMENTTYPES" ADD VALUE 'SEC_CERTIFICATE';

-- DropForeignKey
ALTER TABLE "DocumentVerifications" DROP CONSTRAINT "DocumentVerifications_storeId_fkey";

-- AlterTable
ALTER TABLE "DocumentVerifications" ALTER COLUMN "storeId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "DocumentVerifications" ADD CONSTRAINT "DocumentVerifications_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
