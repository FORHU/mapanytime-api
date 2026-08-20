-- AlterTable
ALTER TABLE "PaymentMethods" ADD COLUMN     "maxOrderAmount" DECIMAL(12,2),
ADD COLUMN     "minOrderAmount" DECIMAL(12,2);
