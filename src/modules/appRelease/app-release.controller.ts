import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { AppReleaseService } from './app-release.service';
import { responseSuccess, responseError } from '../../helpers/response.helper';

export const getLatestRelease = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const latest = await AppReleaseService.getLatestRelease();
    return responseSuccess(res, 200, latest);
  } catch (error) {
    next(error);
  }
};

/**
 * Public history. `includeFailed` is deliberately not read from the query here — honouring it
 * on an unauthenticated route let anyone list pulled builds by asking for them.
 */
export const getPublicReleaseHistory = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const history = await AppReleaseService.getReleaseHistory(false);
    return responseSuccess(res, 200, history);
  } catch (error) {
    next(error);
  }
};

/** Admin history — may include FAILED releases, which the console needs to show rollbacks. */
export const getAdminReleaseHistory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const includeFailed = req.query.includeFailed === 'true';
    const history = await AppReleaseService.getReleaseHistory(includeFailed);
    return responseSuccess(res, 200, history);
  } catch (error) {
    next(error);
  }
};

const createReleaseSchema = Joi.object({
  version: Joi.string().trim().required(),
  buildNumber: Joi.number().integer().min(1).required(),
  channel: Joi.string().valid('Stable', 'Beta').optional(),
  apkUrl: Joi.string().trim().required(),
  fileSize: Joi.string().trim().optional(),
  minAndroidVersion: Joi.string().trim().optional(),
  architecture: Joi.string().trim().optional(),
  // Checksums are shown to users as a tamper check, so a malformed one is worse than none.
  sha256: Joi.string()
    .lowercase()
    .pattern(/^[a-f0-9]{64}$/)
    .optional()
    .messages({ 'string.pattern.base': 'sha256 must be 64 hexadecimal characters.' }),
  // Must be a real list — the old code coerced any scalar into a one-element array, so a typo
  // silently became the release notes.
  whatsNew: Joi.array().items(Joi.string().trim().min(1)).min(1).required(),
  isLatest: Joi.boolean().optional(),
  forceUpdate: Joi.boolean().optional(),
});

export const createRelease = async (req: Request, res: Response, next: NextFunction) => {
  const { error, value } = createReleaseSchema.validate(req.body);
  if (error) {
    return responseError(res, 400, error.message);
  }

  try {
    const release = await AppReleaseService.createRelease({
      ...value,
      isLatest: value.isLatest ?? true,
      forceUpdate: value.forceUpdate ?? false,
    });

    return responseSuccess(res, 201, release, 'App release created successfully');
  } catch (error) {
    next(error);
  }
};

export const rollbackRelease = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const result = await AppReleaseService.rollbackRelease(id);
    return responseSuccess(
      res,
      200,
      result,
      'Release marked as FAILED. Successfully rolled back to previous active release.',
    );
  } catch (error) {
    next(error);
  }
};

export const setLatestRelease = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const release = await AppReleaseService.setLatestRelease(id);
    return responseSuccess(res, 200, release, 'Set as latest release successfully');
  } catch (error) {
    next(error);
  }
};
