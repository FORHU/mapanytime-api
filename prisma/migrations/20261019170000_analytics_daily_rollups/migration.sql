-- CreateTable
CREATE TABLE IF NOT EXISTS "AnalyticsDailyRollups" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "cartAdds" INTEGER NOT NULL DEFAULT 0,
    "orders" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsDailyRollups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AnalyticsDailyRollups_date_targetType_targetId_key" ON "AnalyticsDailyRollups"("date", "targetType", "targetId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AnalyticsDailyRollups_targetType_date_views_idx" ON "AnalyticsDailyRollups"("targetType", "date", "views" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AnalyticsDailyRollups_targetId_date_idx" ON "AnalyticsDailyRollups"("targetId", "date");
