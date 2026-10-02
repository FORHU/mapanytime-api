import express from 'express';
import {
  getLatestRelease,
  getPublicReleaseHistory,
  downloadLatestApk,
  listReleases,
  createUploadUrl,
  createRelease,
  updateRelease,
  setDownloadable,
  rollbackRelease,
  getReleaseDownloadUrl,
} from './app-release.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { requireAdmin } from '../../middleware/admin.middleware';
import { createDownloadLimiter } from '../../middleware/rate-limit.middleware';

/**
 * Unauthenticated. Feeds the landing page's install button, QR code and download dialog.
 * Never expose FAILED releases or S3 keys here.
 */
export const publicAppReleaseRouter = express.Router();

publicAppReleaseRouter.get('/latest', getLatestRelease);
publicAppReleaseRouter.get('/history', getPublicReleaseHistory);
// Each hit presigns a URL to a ~116 MB object; the limiter keeps one client from hammering it.
publicAppReleaseRouter.get('/download', createDownloadLimiter(), downloadLatestApk);

/**
 * Admin-only release management. Kept as a separate router so the mutation routes are not
 * also reachable under the public mount — one router mounted at two prefixes made
 * `POST /v1/app/` a live create endpoint, which is not a URL anyone meant to publish.
 */
export const adminAppReleaseRouter = express.Router();

// Still the coarse role check rather than a permission code: nothing in
// SYSTEM_PERMISSIONS describes publishing a mobile release, and inventing a code here would
// mean seeding a permission no role has been designed around. Revisit if a `releases.manage`
// code is ever added.
adminAppReleaseRouter.use(authenticate, requireAdmin);

adminAppReleaseRouter.get('/', listReleases);
adminAppReleaseRouter.post('/upload-url', createUploadUrl);
adminAppReleaseRouter.post('/', createRelease);
adminAppReleaseRouter.patch('/:id', updateRelease);
adminAppReleaseRouter.post('/:id/set-downloadable', setDownloadable);
adminAppReleaseRouter.post('/:id/rollback', rollbackRelease);
adminAppReleaseRouter.get('/:id/download-url', getReleaseDownloadUrl);
