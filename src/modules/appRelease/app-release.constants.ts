/**
 * Single source of truth for release metadata defaults.
 *
 * These values were previously repeated in the Prisma column defaults, the createRelease
 * fallbacks, and getLatestRelease's empty-table response — and had already drifted apart
 * ('8.0+' vs 'Android 8.0+'). Anything that needs a default reads it from here.
 */
export const RELEASE_DEFAULTS = {
  channel: 'Stable',
  minAndroidVersion: 'Android 8.0+',
  architecture: 'arm64-v8a',
} as const;

/** Sent on upload and on download, so S3 and the browser both treat the object as an APK. */
export const APK_CONTENT_TYPE = 'application/vnd.android.package-archive';

/**
 * Every APK key lives under this prefix. Release creation refuses any other key, so an admin
 * request can't point a release at an unrelated object in the shared bucket.
 */
export const APK_KEY_PREFIX = 'apks/';

/** Upper bound on an APK upload. The current universal build is ~116 MB. */
export const MAX_APK_BYTES = 300 * 1024 * 1024;

/** How long a presigned upload stays valid. Large files on slow links need the headroom. */
export const UPLOAD_URL_TTL_SECONDS = 30 * 60;

/**
 * How long a presigned download stays valid. Short on purpose: clients never store it — they
 * hit GET /v1/app/download, which signs a fresh one each time — so it only has to survive the
 * redirect.
 */
export const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;
