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

adminAppReleaseRouter.use(authenticate, requireAdmin);

adminAppReleaseRouter.get('/history', getAdminReleaseHistory);
adminAppReleaseRouter.post('/', createRelease);
adminAppReleaseRouter.post('/:id/rollback', rollbackRelease);
adminAppReleaseRouter.post('/:id/set-latest', setLatestRelease);
