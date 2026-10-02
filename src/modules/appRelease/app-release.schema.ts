import Joi from 'joi';
import { RELEASESTATUS } from '@prisma/client';
import { MAX_APK_BYTES } from './app-release.constants';

// "1.0.0", "1.2.10", optionally "1.2.0-beta.1". The version ends up in the S3 key and the
// downloaded file name, so it is kept to characters that are safe in both.
const version = Joi.string()
  .trim()
  .pattern(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/)
  .messages({ 'string.pattern.base': 'version must look like 1.0.0 (optionally 1.0.0-beta.1).' });

const fileName = Joi.string()
  .trim()
  .max(200)
  .pattern(/\.apk$/i)
  .messages({ 'string.pattern.base': 'Only .apk files can be uploaded.' });

const fileSizeBytes = Joi.number()
  .integer()
  .min(1)
  .max(MAX_APK_BYTES)
  .messages({ 'number.max': 'The APK is larger than the 300 MB limit.' });

const channel = Joi.string().valid('Stable', 'Beta');
const shortText = Joi.string().trim().max(60);
// Must be a real list — a scalar coerced into a one-element array once let a typo become the
// release notes.
const whatsNew = Joi.array().items(Joi.string().trim().min(1).max(300)).min(1).max(20);

export const uploadUrlSchema = Joi.object({
  version: version.required(),
  fileName: fileName.required(),
  fileSizeBytes: fileSizeBytes.required(),
});

export const createReleaseSchema = Joi.object({
  version: version.required(),
  buildNumber: Joi.number().integer().min(1).required(),
  channel: channel.optional(),
  s3Key: Joi.string().trim().max(500).required(),
  fileName: fileName.required(),
  fileSizeBytes: fileSizeBytes.required(),
  minAndroidVersion: shortText.optional(),
  architecture: shortText.optional(),
  // Checksums are shown to users as a tamper check, so a malformed one is worse than none.
  sha256: Joi.string()
    .lowercase()
    .pattern(/^[a-f0-9]{64}$/)
    .optional()
    .messages({ 'string.pattern.base': 'sha256 must be 64 hexadecimal characters.' }),
  whatsNew: whatsNew.required(),
  forceUpdate: Joi.boolean().optional(),
  makeDownloadable: Joi.boolean().optional(),
});

/** Version, build number and the file itself are immutable — upload a new version instead. */
export const updateReleaseSchema = Joi.object({
  channel: channel.optional(),
  minAndroidVersion: shortText.optional(),
  architecture: shortText.optional(),
  whatsNew: whatsNew.optional(),
  forceUpdate: Joi.boolean().optional(),
  // FAILED is set only by rollback, which also moves the downloadable flag.
  status: Joi.string().valid(RELEASESTATUS.ACTIVE, RELEASESTATUS.DEPRECATED).optional(),
}).min(1);
