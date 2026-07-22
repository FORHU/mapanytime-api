/*
  Warnings:

  - The values [GCASH] on the enum `PAYMENTMETHOD` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "PAYMENTMETHOD_new" AS ENUM ('BANK', 'E_WALLET', 'CASH_ON_DELIVERY');
ALTER TABLE "Payments" ALTER COLUMN "paymentMethod" TYPE "PAYMENTMETHOD_new" USING ("paymentMethod"::text::"PAYMENTMETHOD_new");
ALTER TYPE "PAYMENTMETHOD" RENAME TO "PAYMENTMETHOD_old";
ALTER TYPE "PAYMENTMETHOD_new" RENAME TO "PAYMENTMETHOD";
DROP TYPE "public"."PAYMENTMETHOD_old";
COMMIT;
