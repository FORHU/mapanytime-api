/**
 * Single source of truth for release metadata defaults.
 *
 * These values were previously repeated in the Prisma column defaults, the createRelease
 * fallbacks, and getLatestRelease's empty-table response — and had already drifted apart
 * ('8.0+' vs 'Android 8.0+'). Anything that needs a default reads it from here.
 *
 * Note: prisma/schema.prisma still carries matching @default() values on AppRelease. They are
 * vestigial now that the service always supplies a value, and should come out with the next
 * migration — column defaults are the wrong home for build metadata.
 */
export const RELEASE_DEFAULTS = {
  channel: 'Stable',
  fileSize: '115.9 MB',
  minAndroidVersion: 'Android 8.0+',
  architecture: 'arm64-v8a',
} as const;

/**
 * Returned by GET /v1/app/latest when no release has been published yet, so the download modal
 * and the Flutter update checker always have something coherent to render.
 *
 * `sha256` is deliberately null: a placeholder checksum tells users a good download was
 * tampered with. Only a hash computed from a real artefact belongs here.
 *
 * `apkUrl` is empty for the same reason. It used to name a file under the web app's
 * /public/downloads/, which is gitignored and absent on a fresh deploy — so the "fallback"
 * handed every client a guaranteed 404. Empty means "nothing published yet", and the clients
 * disable their download affordances rather than linking to a dead file.
 */
export const FALLBACK_RELEASE = {
  id: 'default-1.0.0',
  version: '1.0.0',
  buildNumber: 1,
  channel: RELEASE_DEFAULTS.channel,
  apkUrl: '',
  fileSize: RELEASE_DEFAULTS.fileSize,
  minAndroidVersion: RELEASE_DEFAULTS.minAndroidVersion,
  architecture: RELEASE_DEFAULTS.architecture,
  sha256: null,
  whatsNew: [
    'Store Discovery & Realtime Map Updates',
    'Realtime Chat & Notifications',
    'Order Tracking & Cart Management',
  ],
  isLatest: true,
  forceUpdate: false,
} as const;
