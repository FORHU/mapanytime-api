/*
  Warnings:

  - A unique constraint covering the columns `[referenceNumber]` on the table `Payments` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Payments" ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "referenceNumber" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Payments_referenceNumber_key" ON "Payments"("referenceNumber");
