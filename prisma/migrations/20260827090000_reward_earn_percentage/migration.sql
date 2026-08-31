-- AlterTable
ALTER TABLE "RewardConfigurations" ADD COLUMN     "earnPercentage" DECIMAL(7,6) NOT NULL DEFAULT 0.001000;
ALTER TABLE "RewardConfigurations" DROP COLUMN "earnRatePhpPerPoint";
