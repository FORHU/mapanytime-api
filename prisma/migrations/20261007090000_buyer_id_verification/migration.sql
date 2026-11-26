-- CreateEnum
CREATE TYPE "SEX" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "BUYERIDTYPE" AS ENUM ('PHILSYS', 'DRIVERS_LICENSE', 'PASSPORT', 'UMID', 'POSTAL_ID', 'PRC_ID');

-- AlterTable
ALTER TABLE "Users" ADD COLUMN     "dateOfBirth" DATE,
ADD COLUMN     "sex" "SEX";

-- CreateTable
CREATE TABLE "BuyerIdVerifications" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "idType" "BUYERIDTYPE" NOT NULL,
    "idNumber" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuyerIdVerifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BuyerIdVerifications_buyerId_key" ON "BuyerIdVerifications"("buyerId");

-- CreateIndex
CREATE UNIQUE INDEX "BuyerIdVerifications_fileId_key" ON "BuyerIdVerifications"("fileId");

-- CreateIndex
CREATE INDEX "BuyerIdVerifications_verificationStatus_idx" ON "BuyerIdVerifications"("verificationStatus");

-- AddForeignKey
ALTER TABLE "BuyerIdVerifications" ADD CONSTRAINT "BuyerIdVerifications_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerIdVerifications" ADD CONSTRAINT "BuyerIdVerifications_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "Files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerIdVerifications" ADD CONSTRAINT "BuyerIdVerifications_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "Users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

