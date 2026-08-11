-- CreateEnum
CREATE TYPE "RELEASESTATUS" AS ENUM ('ACTIVE', 'DEPRECATED', 'FAILED');

-- AlterTable
ALTER TABLE "Users" ADD COLUMN     "activeSessionId" TEXT;

-- CreateTable
CREATE TABLE "AppRelease" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "buildNumber" INTEGER NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'Stable',
    "apkUrl" TEXT NOT NULL,
    "fileSize" TEXT NOT NULL DEFAULT '115.9 MB',
    "minAndroidVersion" TEXT NOT NULL DEFAULT '8.0+',
    "architecture" TEXT NOT NULL DEFAULT 'arm64-v8a',
    "sha256" TEXT,
    "whatsNew" JSONB NOT NULL,
    "status" "RELEASESTATUS" NOT NULL DEFAULT 'ACTIVE',
    "isLatest" BOOLEAN NOT NULL DEFAULT false,
    "forceUpdate" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppRelease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppRelease_version_key" ON "AppRelease"("version");

-- CreateIndex
CREATE INDEX "AppRelease_status_idx" ON "AppRelease"("status");

-- CreateIndex
CREATE INDEX "AppRelease_isLatest_idx" ON "AppRelease"("isLatest");
