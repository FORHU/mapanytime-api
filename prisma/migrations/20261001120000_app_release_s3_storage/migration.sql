-- APK builds move into S3: the release row keeps the object key, not a hand-pasted URL.

-- "Latest" becomes "downloadable": the one version the landing page serves. Renamed in place
-- (not dropped and re-added) so the flag on existing rows survives.
ALTER TABLE "AppRelease" RENAME COLUMN "isLatest" TO "isDownloadable";
ALTER INDEX "AppRelease_isLatest_idx" RENAME TO "AppRelease_isDownloadable_idx";

-- Releases uploaded to S3 have no external URL; the column stays only for legacy rows.
ALTER TABLE "AppRelease" ALTER COLUMN "apkUrl" DROP NOT NULL;

ALTER TABLE "AppRelease"
    ADD COLUMN "s3Key" TEXT,
    ADD COLUMN "fileName" TEXT,
    ADD COLUMN "fileSizeBytes" INTEGER,
    ADD COLUMN "uploadedById" TEXT;

CREATE UNIQUE INDEX "AppRelease_s3Key_key" ON "AppRelease"("s3Key");
CREATE INDEX "AppRelease_uploadedById_idx" ON "AppRelease"("uploadedById");

ALTER TABLE "AppRelease" ADD CONSTRAINT "AppRelease_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "Users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
