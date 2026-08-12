-- CreateEnum
CREATE TYPE "SELLERCAPACITY" AS ENUM ('OWNER', 'BROKER', 'PROXY');

-- CreateEnum
CREATE TYPE "PROPERTYTYPE" AS ENUM ('HOUSE_LOT', 'RAW_LAND');

-- CreateEnum
CREATE TYPE "PROPERTYSTATUS" AS ENUM ('DRAFT', 'PENDING_REVIEW');

-- CreateTable
CREATE TABLE "Properties" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "sellerCapacity" "SELLERCAPACITY" NOT NULL,
    "legalName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "governmentIdName" TEXT,
    "propertyType" "PROPERTYTYPE" NOT NULL,
    "address" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "subdivision" TEXT,
    "status" "PROPERTYSTATUS" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Properties_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Properties_sellerId_idx" ON "Properties"("sellerId");

-- CreateIndex
CREATE INDEX "Properties_propertyType_idx" ON "Properties"("propertyType");

-- CreateIndex
CREATE INDEX "Properties_status_idx" ON "Properties"("status");

-- CreateIndex
CREATE INDEX "Properties_latitude_longitude_idx" ON "Properties"("latitude", "longitude");

-- AddForeignKey
ALTER TABLE "Properties" ADD CONSTRAINT "Properties_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
