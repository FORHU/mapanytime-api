-- CreateIndex
CREATE INDEX "StoreLocations_latitude_longitude_idx" ON "StoreLocations"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "Stores_isActive_idx" ON "Stores"("isActive");
