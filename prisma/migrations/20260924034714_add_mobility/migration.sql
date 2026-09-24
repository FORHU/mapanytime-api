-- CreateTable
CREATE TABLE "TransportOperators" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransportOperators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportOperatorMembers" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransportOperatorMembers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleTypes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "markerIconUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleTypes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicles" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "vehicleTypeId" TEXT NOT NULL,
    "driverUserId" TEXT,
    "plateNumber" TEXT NOT NULL,
    "trackingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TransportOperatorMembers_userId_idx" ON "TransportOperatorMembers"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TransportOperatorMembers_operatorId_userId_key" ON "TransportOperatorMembers"("operatorId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleTypes_code_key" ON "VehicleTypes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicles_driverUserId_key" ON "Vehicles"("driverUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicles_plateNumber_key" ON "Vehicles"("plateNumber");

-- CreateIndex
CREATE INDEX "Vehicles_operatorId_idx" ON "Vehicles"("operatorId");

-- AddForeignKey
ALTER TABLE "TransportOperatorMembers" ADD CONSTRAINT "TransportOperatorMembers_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "TransportOperators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportOperatorMembers" ADD CONSTRAINT "TransportOperatorMembers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicles" ADD CONSTRAINT "Vehicles_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "TransportOperators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicles" ADD CONSTRAINT "Vehicles_vehicleTypeId_fkey" FOREIGN KEY ("vehicleTypeId") REFERENCES "VehicleTypes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicles" ADD CONSTRAINT "Vehicles_driverUserId_fkey" FOREIGN KEY ("driverUserId") REFERENCES "Users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

