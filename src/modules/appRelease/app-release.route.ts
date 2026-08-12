import express from 'express';
import {
  getLatestRelease,
  getPublicReleaseHistory,
  getAdminReleaseHistory,
  createRelease,
  rollbackRelease,
  setLatestRelease,
} from './app-release.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { requireAdmin } from '../../middleware/admin.middleware';

/**
 * Unauthenticated. Feeds the web download modal and the Flutter update checker.
 * Never expose FAILED releases here — a pulled build is not something to advertise.
 */
export const publicAppReleaseRouter = express.Router();

publicAppReleaseRouter.get('/latest', getLatestRelease);
publicAppReleaseRouter.get('/history', getPublicReleaseHistory);

/**
 * Admin-only release management. Kept as a separate router so the mutation routes are not
 * also reachable under the public mount — one router mounted at two prefixes made
 * `POST /v1/app/` a live create endpoint, which is not a URL anyone meant to publish.
 */
export const adminAppReleaseRouter = express.Router();

// Still the coarse role check rather than a permission code: nothing in
// SYSTEM_PERMISSIONS describes publishing or rolling back a mobile release, and
// inventing a code here would mean seeding a permission no role has been
// designed around. Revisit if a `releases.manage` code is ever added.
adminAppReleaseRouter.use(authenticate, requireAdmin);

adminAppReleaseRouter.get('/history', getAdminReleaseHistory);
adminAppReleaseRouter.post('/', createRelease);
adminAppReleaseRouter.post('/:id/rollback', rollbackRelease);
adminAppReleaseRouter.post('/:id/set-latest', setLatestRelease);
