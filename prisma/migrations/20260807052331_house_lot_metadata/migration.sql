-- CreateEnum
CREATE TYPE "TERRAIN" AS ENUM ('FLAT', 'SLOPING', 'ROLLING', 'MOUNTAINOUS');

-- CreateEnum
CREATE TYPE "FURNISHING" AS ENUM ('BARE', 'SEMI_FURNISHED', 'FULLY_FURNISHED');

-- CreateEnum
CREATE TYPE "TITLETYPE" AS ENUM ('TCT', 'OCT', 'TAX_DECLARATION');

-- CreateEnum
CREATE TYPE "NEGOTIABILITY" AS ENUM ('FIXED', 'NEGOTIABLE');

-- CreateEnum
CREATE TYPE "TAXRESPONSIBILITY" AS ENUM ('SELLER', 'BUYER', 'STANDARD_SHARING');

-- DropIndex
DROP INDEX "Stores_approvalStatus_idx";

-- AlterTable
ALTER TABLE "Properties" ADD COLUMN     "authorityToSellFile" TEXT,
ADD COLUMN     "bathrooms" INTEGER,
ADD COLUMN     "bedrooms" INTEGER,
ADD COLUMN     "floorArea" DOUBLE PRECISION,
ADD COLUMN     "furnishing" "FURNISHING",
ADD COLUMN     "hoaDues" DECIMAL(12,2),
ADD COLUMN     "latestTaxReceiptFile" TEXT,
ADD COLUMN     "lotArea" DOUBLE PRECISION,
ADD COLUMN     "lotPlanFile" TEXT,
ADD COLUMN     "negotiability" "NEGOTIABILITY",
ADD COLUMN     "parkingSpaces" INTEGER,
ADD COLUMN     "scannedTitleFile" TEXT,
ADD COLUMN     "sellingPrice" DECIMAL(12,2),
ADD COLUMN     "taxResponsibilities" "TAXRESPONSIBILITY",
ADD COLUMN     "terrain" "TERRAIN",
ADD COLUMN     "titleNumber" TEXT,
ADD COLUMN     "titleType" "TITLETYPE",
ADD COLUMN     "yearBuilt" INTEGER;
