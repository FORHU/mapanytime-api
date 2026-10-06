-- CreateTable
CREATE TABLE "SavedStores" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedStores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedStores_buyerId_idx" ON "SavedStores"("buyerId");

-- CreateIndex
CREATE INDEX "SavedStores_storeId_idx" ON "SavedStores"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "SavedStores_buyerId_storeId_key" ON "SavedStores"("buyerId", "storeId");

-- AddForeignKey
ALTER TABLE "SavedStores" ADD CONSTRAINT "SavedStores_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedStores" ADD CONSTRAINT "SavedStores_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

