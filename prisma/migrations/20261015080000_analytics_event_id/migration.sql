-- Event-bus eventId on analytics rows (#142). Unique, so an SQS redelivery
-- writes nothing; null for rows written directly when the bus was down.

-- AlterTable
ALTER TABLE "AnalyticsEvents" ADD COLUMN "eventId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsEvents_eventId_key" ON "AnalyticsEvents"("eventId");
