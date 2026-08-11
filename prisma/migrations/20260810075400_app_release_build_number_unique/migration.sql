-- Build metadata defaults now live in app-release.constants.ts (RELEASE_DEFAULTS), which the
-- service always reads from. Keeping a second copy in the column defaults is what let
-- minAndroidVersion drift ('8.0+' here vs 'Android 8.0+' in the constants), so they come out.
ALTER TABLE "AppRelease" ALTER COLUMN "channel" DROP DEFAULT;
ALTER TABLE "AppRelease" ALTER COLUMN "fileSize" DROP DEFAULT;
ALTER TABLE "AppRelease" ALTER COLUMN "minAndroidVersion" DROP DEFAULT;
ALTER TABLE "AppRelease" ALTER COLUMN "architecture" DROP DEFAULT;

-- CreateIndex
-- buildNumber drives every ordering in the release module (the isLatest fallback, the rollback
-- target, the admin console's next-build calculation), so duplicates would make "the latest
-- release" nondeterministic. This also supplies the index those ORDER BY clauses want.
-- Fails if duplicate build numbers already exist; deduplicate before applying.
CREATE UNIQUE INDEX "AppRelease_buildNumber_key" ON "AppRelease"("buildNumber");
