import { prisma } from '../../utils/prisma';
import { RELEASESTATUS } from '@prisma/client';
import { RELEASE_DEFAULTS, FALLBACK_RELEASE } from './app-release.constants';

export class AppReleaseService {
  /**
   * Get the active latest release.
   * If the latest release was marked FAILED, automatically falls back to the highest active build.
   */
  static async getLatestRelease() {
    // 1. Try finding explicitly marked latest active release
    let latest = await prisma.appRelease.findFirst({
      where: {
        isLatest: true,
        status: RELEASESTATUS.ACTIVE,
      },
      orderBy: { buildNumber: 'desc' },
    });

    // 2. Fallback to highest active build number if no explicit latest exists
    if (!latest) {
      latest = await prisma.appRelease.findFirst({
        where: {
          status: RELEASESTATUS.ACTIVE,
        },
        orderBy: { buildNumber: 'desc' },
      });
    }

    // 3. Fallback default if DB table is empty
    if (!latest) {
      return {
        ...FALLBACK_RELEASE,
        whatsNew: [...FALLBACK_RELEASE.whatsNew],
        status: RELEASESTATUS.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }

    return latest;
  }

  /**
   * Get version history (all non-failed releases for public, or all for admin)
   */
  static async getReleaseHistory(includeFailed = false) {
    return prisma.appRelease.findMany({
      where: includeFailed ? {} : { status: { not: RELEASESTATUS.FAILED } },
      orderBy: { buildNumber: 'desc' },
    });
  }

  /**
   * Create or publish a new release
   */
  static async createRelease(data: {
    version: string;
    buildNumber: number;
    channel?: string;
    apkUrl: string;
    fileSize?: string;
    minAndroidVersion?: string;
    architecture?: string;
    sha256?: string;
    whatsNew: string[];
    isLatest?: boolean;
    forceUpdate?: boolean;
  }) {
    const isLatest = data.isLatest ?? true;

    // Demote-then-create has to be atomic. `version` and `buildNumber` are both unique, so a
    // duplicate publish — the likeliest failure here — would otherwise commit the demotion and
    // roll back nothing, leaving the table with no isLatest row at all.
    return prisma.$transaction(async (tx) => {
      if (isLatest) {
        await tx.appRelease.updateMany({
          where: { isLatest: true },
          data: { isLatest: false },
        });
      }

      return tx.appRelease.create({
        data: {
          version: data.version,
          buildNumber: data.buildNumber,
          channel: data.channel ?? RELEASE_DEFAULTS.channel,
          apkUrl: data.apkUrl,
          fileSize: data.fileSize ?? RELEASE_DEFAULTS.fileSize,
          minAndroidVersion: data.minAndroidVersion ?? RELEASE_DEFAULTS.minAndroidVersion,
          architecture: data.architecture ?? RELEASE_DEFAULTS.architecture,
          sha256: data.sha256,
          whatsNew: data.whatsNew,
          status: RELEASESTATUS.ACTIVE,
          isLatest,
          forceUpdate: data.forceUpdate ?? false,
        },
      });
    });
  }

  /**
   * Rollback a broken/failed release. Marks target release as FAILED and sets highest remaining active as latest.
   */
  static async rollbackRelease(id: string) {
    // Marking FAILED and promoting the replacement is one operation — a crash between the two
    // leaves the app with no latest release at all, which is exactly the state a rollback is
    // supposed to get us out of.
    return prisma.$transaction(async (tx) => {
      // 1. Mark release as FAILED. Checked first so an unknown id is a 404 rather than a
      //    Prisma P2025 surfacing as a 500.
      const target = await tx.appRelease.findUnique({ where: { id } });
      if (!target) {
        throw { status: 404, message: 'Release not found.' };
      }

      const failedRelease = await tx.appRelease.update({
        where: { id },
        data: {
          status: RELEASESTATUS.FAILED,
          isLatest: false,
        },
      });

      // 2. Find previous highest ACTIVE release
      const previousActive = await tx.appRelease.findFirst({
        where: {
          status: RELEASESTATUS.ACTIVE,
        },
        orderBy: { buildNumber: 'desc' },
      });

      // 3. Promote previous active release to isLatest = true. Return the promoted row rather
      //    than the pre-update copy, so activeRelease.isLatest isn't reported as false.
      const promoted = previousActive
        ? await tx.appRelease.update({
            where: { id: previousActive.id },
            data: { isLatest: true },
          })
        : null;

      return {
        failedRelease,
        activeRelease: promoted,
      };
    });
  }

  /**
   * Promote a release to latest.
   *
   * A FAILED release is one someone deliberately pulled, so this refuses to quietly un-fail it —
   * shipping a known-broken build to every user because one click also flipped its status is not
   * a recoverable mistake. Re-publishing a pulled build is a separate, explicit act.
   */
  static async setLatestRelease(id: string) {
    return prisma.$transaction(async (tx) => {
      const target = await tx.appRelease.findUnique({ where: { id } });
      if (!target) {
        throw { status: 404, message: 'Release not found.' };
      }

      if (target.status === RELEASESTATUS.FAILED) {
        throw {
          status: 409,
          message:
            'This release was rolled back and cannot be promoted. Publish a new release instead.',
        };
      }

      await tx.appRelease.updateMany({
        where: { isLatest: true },
        data: { isLatest: false },
      });

      return tx.appRelease.update({
        where: { id },
        data: {
          isLatest: true,
          status: RELEASESTATUS.ACTIVE,
        },
      });
    });
  }
}
