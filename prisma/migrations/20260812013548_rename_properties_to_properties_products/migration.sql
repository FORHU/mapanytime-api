/*
  Warnings:

  - You are about to drop the `Properties` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Properties" DROP CONSTRAINT "Properties_reviewedById_fkey";

-- DropForeignKey
ALTER TABLE "Properties" DROP CONSTRAINT "Properties_sellerId_fkey";

-- DropTable
DROP TABLE "Properties";

-- CreateTable
CREATE TABLE "PropertiesFiles" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "titleType" "TITLETYPE",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropertiesFiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertiesProducts" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "sellerCapacity" "SELLERCAPACITY" NOT NULL,
    "legalName" TEXT NOT NULL,
    "governmentIdName" TEXT,
    "propertyType" "PROPERTYTYPE" NOT NULL,
    "address" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "subdivision" TEXT,
    "status" "PROPERTYSTATUS" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "rejectionReason" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "lotArea" DOUBLE PRECISION,
    "terrain" "TERRAIN",
    "floorArea" DOUBLE PRECISION,
    "bedrooms" INTEGER,
    "bathrooms" INTEGER,
    "parkingSpaces" INTEGER,
    "yearBuilt" INTEGER,
    "furnishing" "FURNISHING",
    "sellingPrice" DECIMAL(12,2),
    "negotiability" "NEGOTIABILITY",
    "taxResponsibilities" "TAXRESPONSIBILITY",
    "hoaDues" DECIMAL(12,2),

    CONSTRAINT "PropertiesProducts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PropertiesFiles_propertyId_idx" ON "PropertiesFiles"("propertyId");

-- CreateIndex
CREATE INDEX "PropertiesProducts_storeId_idx" ON "PropertiesProducts"("storeId");

-- CreateIndex
CREATE INDEX "PropertiesProducts_propertyType_idx" ON "PropertiesProducts"("propertyType");

-- CreateIndex
CREATE INDEX "PropertiesProducts_status_idx" ON "PropertiesProducts"("status");

-- CreateIndex
CREATE INDEX "PropertiesProducts_latitude_longitude_idx" ON "PropertiesProducts"("latitude", "longitude");

-- AddForeignKey
ALTER TABLE "PropertiesFiles" ADD CONSTRAINT "PropertiesFiles_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "PropertiesProducts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertiesFiles" ADD CONSTRAINT "PropertiesFiles_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "Files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertiesProducts" ADD CONSTRAINT "PropertiesProducts_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertiesProducts" ADD CONSTRAINT "PropertiesProducts_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "Users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
