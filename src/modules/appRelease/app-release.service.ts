import crypto from 'crypto';
import { AppRelease, Prisma, RELEASESTATUS } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import S3Util from '../../utils/s3.util';
import { throwResponse } from '../../utils/throw-response';
import {
  APK_CONTENT_TYPE,
  APK_KEY_PREFIX,
  DOWNLOAD_URL_TTL_SECONDS,
  RELEASE_DEFAULTS,
  UPLOAD_URL_TTL_SECONDS,
} from './app-release.constants';

type UploaderSummary = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
};
type ReleaseWithUploader = AppRelease & { uploadedBy?: UploaderSummary | null };

/** What anonymous clients see: never the S3 key, the legacy URL, or who uploaded it. */
export function toPublicRelease(row: AppRelease) {
  return {
    id: row.id,
    version: row.version,
    buildNumber: row.buildNumber,
    channel: row.channel,
    fileName: row.fileName,
    fileSize: row.fileSize,
    fileSizeBytes: row.fileSizeBytes,
    minAndroidVersion: row.minAndroidVersion,
    architecture: row.architecture,
    sha256: row.sha256,
    whatsNew: row.whatsNew,
    forceUpdate: row.forceUpdate,
    createdAt: row.createdAt,
  };
}

/** What the admin console sees: everything, plus whether there is a file to serve. */
export function toAdminRelease(row: ReleaseWithUploader) {
  return {
    ...row,
    hasFile: Boolean(row.s3Key || row.apkUrl),
    uploadedBy: row.uploadedBy ?? null,
  };
}

/** "115.9 MB" — the display string clients have always received in `fileSize`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Keeps a file name safe for an S3 key and a Content-Disposition header. */
function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-');
  return cleaned.toLowerCase().endsWith('.apk') ? cleaned : `${cleaned}.apk`;
}

/** The name the visitor's browser saves the download as. */
export function downloadFileName(version: string): string {
  return `MapAnytime-v${version}.apk`;
}

const uploaderSelect = {
  select: { id: true, firstName: true, lastName: true, email: true },
} as const;

export class AppReleaseService {
  /**
   * The version the landing page serves, or null when an admin hasn't made one downloadable.
   *
   * There is deliberately no "highest active build" fallback: the requirement is that visitors
   * get exactly the version an admin selected, and a fallback would quietly ship whatever was
   * uploaded last.
   */
  static async getDownloadable() {
    return prisma.appRelease.findFirst({
      where: { isDownloadable: true, status: RELEASESTATUS.ACTIVE },
    });
  }

  /** Public history: every release except pulled (FAILED) builds. */
  static async getPublicHistory() {
    return prisma.appRelease.findMany({
      where: { status: { not: RELEASESTATUS.FAILED } },
      orderBy: { buildNumber: 'desc' },
    });
  }

  /** Admin list: every release, newest build first. */
  static async listForAdmin() {
    return prisma.appRelease.findMany({
      orderBy: { buildNumber: 'desc' },
      include: { uploadedBy: uploaderSelect },
    });
  }

  /**
   * Step one of an upload: reserve a key under `apks/` and presign a PUT for it. The browser
   * uploads straight to S3 — a ~116 MB APK has no business passing through the API.
   *
   * Duplicate versions are refused here, before the admin waits through an upload that
   * createRelease would reject anyway.
   */
  static async createUploadUrl(data: { version: string; fileName: string }) {
    const existing = await prisma.appRelease.findUnique({ where: { version: data.version } });
    if (existing) {
      throwResponse(409, `Version ${data.version} already exists. Use a new version number.`);
    }

    const s3Key = `${APK_KEY_PREFIX}v${data.version}/${crypto.randomBytes(8).toString('hex')}/${sanitizeFileName(data.fileName)}`;
    const uploadUrl = await S3Util.presignPut(s3Key, APK_CONTENT_TYPE, UPLOAD_URL_TTL_SECONDS);

    return { uploadUrl, s3Key, contentType: APK_CONTENT_TYPE, expiresIn: UPLOAD_URL_TTL_SECONDS };
  }

  /**
   * Step two: record the release once the file is in S3.
   *
   * The object is checked rather than trusted: it must exist under `apks/` and be exactly the
   * size the admin's browser reported. That catches a failed or truncated upload before it can
   * become the version every visitor downloads.
   */
  static async createRelease(
    data: {
      version: string;
      buildNumber: number;
      channel?: string;
      s3Key: string;
      fileName: string;
      fileSizeBytes: number;
      minAndroidVersion?: string;
      architecture?: string;
      sha256?: string;
      whatsNew: string[];
      forceUpdate?: boolean;
      makeDownloadable?: boolean;
    },
    uploadedById?: string,
  ) {
    if (!data.s3Key.startsWith(APK_KEY_PREFIX) || data.s3Key.includes('..')) {
      throwResponse(400, 'The APK must be uploaded through the release upload flow.');
    }

    const object = await S3Util.headObject(data.s3Key);
    if (!object) {
      throwResponse(400, 'The APK was not found in storage. Upload it again.');
    }
    if (object.contentLength !== data.fileSizeBytes) {
      throwResponse(400, 'The uploaded APK is incomplete. Upload it again.');
    }

    const makeDownloadable = data.makeDownloadable ?? false;

    // Demote-then-create has to be atomic. `version`, `buildNumber` and `s3Key` are unique, so a
    // duplicate — the likeliest failure — would otherwise commit the demotion and leave nothing
    // downloadable at all.
    const release = await prisma.$transaction(async (tx) => {
      if (makeDownloadable) {
        await tx.appRelease.updateMany({
          where: { isDownloadable: true },
          data: { isDownloadable: false },
        });
      }

      return tx.appRelease.create({
        data: {
          version: data.version,
          buildNumber: data.buildNumber,
          channel: data.channel ?? RELEASE_DEFAULTS.channel,
          s3Key: data.s3Key,
          fileName: data.fileName,
          fileSizeBytes: data.fileSizeBytes,
          fileSize: formatBytes(data.fileSizeBytes),
          minAndroidVersion: data.minAndroidVersion ?? RELEASE_DEFAULTS.minAndroidVersion,
          architecture: data.architecture ?? RELEASE_DEFAULTS.architecture,
          sha256: data.sha256,
          whatsNew: data.whatsNew,
          status: RELEASESTATUS.ACTIVE,
          isDownloadable: makeDownloadable,
          forceUpdate: data.forceUpdate ?? false,
          uploadedById: uploadedById ?? null,
        },
        include: { uploadedBy: uploaderSelect },
      });
    });

    return toAdminRelease(release);
  }

  /** Edits descriptive fields. The version and the file are immutable — upload a new version. */
  static async updateRelease(
    id: string,
    data: {
      channel?: string;
      minAndroidVersion?: string;
      architecture?: string;
      whatsNew?: string[];
      forceUpdate?: boolean;
      status?: RELEASESTATUS;
    },
  ) {
    const target = await prisma.appRelease.findUnique({ where: { id } });
    if (!target) throwResponse(404, 'Release not found.');

    if (data.status && data.status !== target.status) {
      if (target.status === RELEASESTATUS.FAILED) {
        throwResponse(409, 'This release was rolled back. Upload a new version instead.');
      }
      if (data.status === RELEASESTATUS.DEPRECATED && target.isDownloadable) {
        throwResponse(
          409,
          'This is the version visitors download. Make another version downloadable first.',
        );
      }
    }

    const updated = await prisma.appRelease.update({
      where: { id },
      data: data as Prisma.AppReleaseUpdateInput,
      include: { uploadedBy: uploaderSelect },
    });
    return toAdminRelease(updated);
  }

  /**
   * Makes one version the downloadable one, and every other version not.
   *
   * A FAILED release is one someone deliberately pulled, so this refuses to quietly un-fail it —
   * shipping a known-broken build to every visitor because one click also flipped its status is
   * not a recoverable mistake.
   */
  static async setDownloadable(id: string) {
    const release = await prisma.$transaction(async (tx) => {
      const target = await tx.appRelease.findUnique({ where: { id } });
      if (!target) throwResponse(404, 'Release not found.');

      if (target.status === RELEASESTATUS.FAILED) {
        throwResponse(
          409,
          'This release was rolled back and cannot be made downloadable. Upload a new version instead.',
        );
      }
      if (!target.s3Key && !target.apkUrl) {
        throwResponse(409, 'This release has no APK file to download.');
      }

      await tx.appRelease.updateMany({
        where: { isDownloadable: true, id: { not: id } },
        data: { isDownloadable: false },
      });

      return tx.appRelease.update({
        where: { id },
        data: { isDownloadable: true, status: RELEASESTATUS.ACTIVE },
        include: { uploadedBy: uploaderSelect },
      });
    });

    return toAdminRelease(release);
  }

  /**
   * Pulls a broken release: marks it FAILED and, if it was the downloadable one, hands that flag
   * to the highest remaining ACTIVE build that has a file.
   */
  static async rollbackRelease(id: string) {
    // Marking FAILED and promoting the replacement is one operation — a crash between the two
    // would leave nothing downloadable, which is exactly the state a rollback is meant to end.
    return prisma.$transaction(async (tx) => {
      const target = await tx.appRelease.findUnique({ where: { id } });
      if (!target) throwResponse(404, 'Release not found.');

      const failedRelease = await tx.appRelease.update({
        where: { id },
        data: { status: RELEASESTATUS.FAILED, isDownloadable: false },
      });

      let activeRelease: AppRelease | null = null;
      if (target.isDownloadable) {
        const previous = await tx.appRelease.findFirst({
          where: {
            status: RELEASESTATUS.ACTIVE,
            OR: [{ s3Key: { not: null } }, { apkUrl: { not: null } }],
          },
          orderBy: { buildNumber: 'desc' },
        });
        activeRelease = previous
          ? await tx.appRelease.update({
              where: { id: previous.id },
              data: { isDownloadable: true },
            })
          : null;
      } else {
        activeRelease = await tx.appRelease.findFirst({
          where: { isDownloadable: true, status: RELEASESTATUS.ACTIVE },
        });
      }

      return { failedRelease, activeRelease };
    });
  }

  /**
   * A short-lived URL the browser can download the APK from: the downloadable release when `id`
   * is omitted (public), or a specific release (admin). Null when there is nothing to serve.
   */
  static async getDownloadUrl(id?: string): Promise<string | null> {
    const release = id
      ? await prisma.appRelease.findUnique({ where: { id } })
      : await AppReleaseService.getDownloadable();
    if (!release) return null;

    if (release.s3Key) {
      return S3Util.presignDownload(release.s3Key, {
        fileName: downloadFileName(release.version),
        contentType: APK_CONTENT_TYPE,
        expiresIn: DOWNLOAD_URL_TTL_SECONDS,
      });
    }
    return release.apkUrl || null;
  }
}
