import { Request, Response, NextFunction } from 'express';
import { AppReleaseService, toAdminRelease, toPublicRelease } from './app-release.service';
import { createReleaseSchema, updateReleaseSchema, uploadUrlSchema } from './app-release.schema';
import { responseSuccess, responseError } from '../../helpers/response.helper';

/* ── Public ─────────────────────────────────────────────────────────────── */

/**
 * The version visitors would download right now. `available: false` with a null release means
 * no admin has made a version downloadable yet; clients show their "coming soon" state.
 */
export const getLatestRelease = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const release = await AppReleaseService.getDownloadable();
    return responseSuccess(res, 200, {
      available: Boolean(release && (release.s3Key || release.apkUrl)),
      release: release ? toPublicRelease(release) : null,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Public history. FAILED releases are never listed — a pulled build is not something to
 * advertise — and the query string is not read, so nobody can ask for them.
 */
export const getPublicReleaseHistory = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const history = await AppReleaseService.getPublicHistory();
    return responseSuccess(res, 200, history.map(toPublicRelease));
  } catch (error) {
    next(error);
  }
};

/**
 * The install link. Redirects to a freshly presigned, short-lived S3 URL for the downloadable
 * version, so the bucket stays private and the link itself (in buttons and QR codes) never
 * expires or names a version.
 */
export const downloadLatestApk = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const url = await AppReleaseService.getDownloadUrl();
    if (!url) {
      return responseError(res, 404, 'No version is available for download yet.');
    }
    res.set('Cache-Control', 'no-store');
    return res.redirect(302, url);
  } catch (error) {
    next(error);
  }
};

/* ── Admin ──────────────────────────────────────────────────────────────── */

export const listReleases = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const releases = await AppReleaseService.listForAdmin();
    return responseSuccess(res, 200, releases.map(toAdminRelease));
  } catch (error) {
    next(error);
  }
};

export const createUploadUrl = async (req: Request, res: Response, next: NextFunction) => {
  const { error, value } = uploadUrlSchema.validate(req.body);
  if (error) {
    return responseError(res, 400, error.message);
  }

  try {
    const result = await AppReleaseService.createUploadUrl(value);
    return responseSuccess(res, 201, result);
  } catch (error) {
    next(error);
  }
};

export const createRelease = async (req: Request, res: Response, next: NextFunction) => {
  const { error, value } = createReleaseSchema.validate(req.body);
  if (error) {
    return responseError(res, 400, error.message);
  }

  try {
    const release = await AppReleaseService.createRelease(value, req.user?.id);
    return responseSuccess(res, 201, release, 'App release created successfully');
  } catch (error) {
    next(error);
  }
};

export const updateRelease = async (req: Request, res: Response, next: NextFunction) => {
  const { error, value } = updateReleaseSchema.validate(req.body);
  if (error) {
    return responseError(res, 400, error.message);
  }

  try {
    const release = await AppReleaseService.updateRelease(req.params.id, value);
    return responseSuccess(res, 200, release, 'Release updated');
  } catch (error) {
    next(error);
  }
};

export const setDownloadable = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const release = await AppReleaseService.setDownloadable(req.params.id);
    return responseSuccess(res, 200, release, `Version ${release.version} is now downloadable`);
  } catch (error) {
    next(error);
  }
};

export const rollbackRelease = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await AppReleaseService.rollbackRelease(req.params.id);
    return responseSuccess(
      res,
      200,
      result,
      result.activeRelease
        ? `Release marked as FAILED. Version ${result.activeRelease.version} is downloadable.`
        : 'Release marked as FAILED. No version is downloadable now.',
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Lets an admin fetch any stored version, e.g. to test an older build before re-selecting it.
 *
 * JSON rather than a redirect: this route needs the bearer token, so the console calls it with
 * fetch, and a browser can't read a redirect target from fetch. The console opens the URL itself.
 */
export const getReleaseDownloadUrl = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const url = await AppReleaseService.getDownloadUrl(req.params.id);
    if (!url) {
      return responseError(res, 404, 'This release has no APK file.');
    }
    res.set('Cache-Control', 'no-store');
    return responseSuccess(res, 200, { url });
  } catch (error) {
    next(error);
  }
};
