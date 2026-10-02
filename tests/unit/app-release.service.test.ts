/**
 * Release storage and selection. Prisma and S3 are mocked: these tests pin the rules — one
 * downloadable version, keys confined to apks/, uploads verified against S3 — not the database.
 */

const tx = {
  appRelease: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
};

jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    appRelease: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock('../../src/utils/s3.util', () => ({
  __esModule: true,
  default: {
    presignPut: jest.fn().mockResolvedValue('https://s3.example.com/put-signed'),
    presignDownload: jest.fn().mockResolvedValue('https://s3.example.com/get-signed'),
    headObject: jest.fn(),
  },
}));

import { RELEASESTATUS } from '@prisma/client';
import { prisma } from '../../src/utils/prisma';
import S3Util from '../../src/utils/s3.util';
import {
  AppReleaseService,
  formatBytes,
  toPublicRelease,
} from '../../src/modules/appRelease/app-release.service';

const mockPrisma = prisma as unknown as {
  appRelease: Record<'findUnique' | 'findFirst' | 'findMany' | 'update', jest.Mock>;
};
const mockS3 = S3Util as unknown as Record<
  'presignPut' | 'presignDownload' | 'headObject',
  jest.Mock
>;

const row = (over: Record<string, unknown> = {}) => ({
  id: 'rel-1',
  version: '1.0.0',
  buildNumber: 1,
  channel: 'Stable',
  fileSize: '115.9 MB',
  minAndroidVersion: 'Android 8.0+',
  architecture: 'arm64-v8a',
  sha256: null,
  whatsNew: ['First release'],
  s3Key: 'apks/v1.0.0/abc/app.apk',
  fileName: 'app.apk',
  fileSizeBytes: 1000,
  apkUrl: null,
  status: RELEASESTATUS.ACTIVE,
  isDownloadable: false,
  forceUpdate: false,
  uploadedById: 'admin-1',
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
  ...over,
});

const createInput = {
  version: '1.0.1',
  buildNumber: 2,
  s3Key: 'apks/v1.0.1/abc/app.apk',
  fileName: 'app.apk',
  fileSizeBytes: 1000,
  whatsNew: ['Fixes'],
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('createUploadUrl', () => {
  it('reserves a key under apks/ named for the version', async () => {
    mockPrisma.appRelease.findUnique.mockResolvedValue(null);

    const result = await AppReleaseService.createUploadUrl({
      version: '1.2.0',
      fileName: 'My Build (final).apk',
    });

    expect(result.s3Key).toMatch(/^apks\/v1\.2\.0\/[0-9a-f]{16}\/My-Build-final-\.apk$/);
    expect(result.contentType).toBe('application/vnd.android.package-archive');
    expect(mockS3.presignPut).toHaveBeenCalledWith(
      result.s3Key,
      'application/vnd.android.package-archive',
      expect.any(Number),
    );
  });

  it('refuses a version that already exists before any upload happens', async () => {
    mockPrisma.appRelease.findUnique.mockResolvedValue(row());

    await expect(
      AppReleaseService.createUploadUrl({ version: '1.0.0', fileName: 'app.apk' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(mockS3.presignPut).not.toHaveBeenCalled();
  });
});

describe('createRelease', () => {
  it('rejects keys outside apks/', async () => {
    await expect(
      AppReleaseService.createRelease({ ...createInput, s3Key: 'products/abc.jpg' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(mockS3.headObject).not.toHaveBeenCalled();
  });

  it('rejects path traversal inside the prefix', async () => {
    await expect(
      AppReleaseService.createRelease({ ...createInput, s3Key: 'apks/../products/x.apk' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects an upload that never reached S3', async () => {
    mockS3.headObject.mockResolvedValue(null);

    await expect(AppReleaseService.createRelease(createInput)).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('not found'),
    });
    expect(tx.appRelease.create).not.toHaveBeenCalled();
  });

  it('rejects a truncated upload', async () => {
    mockS3.headObject.mockResolvedValue({ contentLength: 400 });

    await expect(AppReleaseService.createRelease(createInput)).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('incomplete'),
    });
  });

  it('saves the key and size, and demotes the others when made downloadable', async () => {
    mockS3.headObject.mockResolvedValue({ contentLength: 1000 });
    tx.appRelease.create.mockImplementation(({ data }) => Promise.resolve({ id: 'new', ...data }));

    const created = await AppReleaseService.createRelease(
      { ...createInput, makeDownloadable: true },
      'admin-1',
    );

    expect(tx.appRelease.updateMany).toHaveBeenCalledWith({
      where: { isDownloadable: true },
      data: { isDownloadable: false },
    });
    expect(tx.appRelease.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          s3Key: createInput.s3Key,
          fileSizeBytes: 1000,
          fileSize: '1000 B',
          isDownloadable: true,
          uploadedById: 'admin-1',
        }),
      }),
    );
    expect(created.hasFile).toBe(true);
  });

  it('leaves the current downloadable version alone by default', async () => {
    mockS3.headObject.mockResolvedValue({ contentLength: 1000 });
    tx.appRelease.create.mockResolvedValue(row({ id: 'new' }));

    await AppReleaseService.createRelease(createInput);

    expect(tx.appRelease.updateMany).not.toHaveBeenCalled();
  });
});

describe('setDownloadable', () => {
  it('demotes every other release and promotes the target', async () => {
    tx.appRelease.findUnique.mockResolvedValue(row({ id: 'rel-2' }));
    tx.appRelease.update.mockResolvedValue(row({ id: 'rel-2', isDownloadable: true }));

    const result = await AppReleaseService.setDownloadable('rel-2');

    expect(tx.appRelease.updateMany).toHaveBeenCalledWith({
      where: { isDownloadable: true, id: { not: 'rel-2' } },
      data: { isDownloadable: false },
    });
    expect(tx.appRelease.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'rel-2' },
        data: { isDownloadable: true, status: RELEASESTATUS.ACTIVE },
      }),
    );
    expect(result.isDownloadable).toBe(true);
  });

  it('refuses a release that was rolled back', async () => {
    tx.appRelease.findUnique.mockResolvedValue(row({ status: RELEASESTATUS.FAILED }));

    await expect(AppReleaseService.setDownloadable('rel-1')).rejects.toMatchObject({ status: 409 });
    expect(tx.appRelease.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a release with no file', async () => {
    tx.appRelease.findUnique.mockResolvedValue(row({ s3Key: null, apkUrl: null }));

    await expect(AppReleaseService.setDownloadable('rel-1')).rejects.toMatchObject({ status: 409 });
  });

  it('404s an unknown id', async () => {
    tx.appRelease.findUnique.mockResolvedValue(null);

    await expect(AppReleaseService.setDownloadable('nope')).rejects.toMatchObject({ status: 404 });
  });
});

describe('updateRelease', () => {
  it('will not deprecate the version visitors are downloading', async () => {
    mockPrisma.appRelease.findUnique.mockResolvedValue(row({ isDownloadable: true }));

    await expect(
      AppReleaseService.updateRelease('rel-1', { status: RELEASESTATUS.DEPRECATED }),
    ).rejects.toMatchObject({ status: 409 });
    expect(mockPrisma.appRelease.update).not.toHaveBeenCalled();
  });

  it('updates descriptive fields', async () => {
    mockPrisma.appRelease.findUnique.mockResolvedValue(row());
    mockPrisma.appRelease.update.mockResolvedValue(row({ whatsNew: ['New notes'] }));

    const updated = await AppReleaseService.updateRelease('rel-1', { whatsNew: ['New notes'] });

    expect(updated.whatsNew).toEqual(['New notes']);
  });
});

describe('rollbackRelease', () => {
  it('hands the downloadable flag to the highest remaining build with a file', async () => {
    tx.appRelease.findUnique.mockResolvedValue(row({ id: 'rel-2', isDownloadable: true }));
    tx.appRelease.update
      .mockResolvedValueOnce(row({ id: 'rel-2', status: RELEASESTATUS.FAILED }))
      .mockResolvedValueOnce(row({ id: 'rel-1', isDownloadable: true }));
    tx.appRelease.findFirst.mockResolvedValue(row({ id: 'rel-1' }));

    const result = await AppReleaseService.rollbackRelease('rel-2');

    expect(result.activeRelease?.id).toBe('rel-1');
    expect(tx.appRelease.update).toHaveBeenLastCalledWith({
      where: { id: 'rel-1' },
      data: { isDownloadable: true },
    });
  });

  it('does not move the flag when the pulled release was not the downloadable one', async () => {
    tx.appRelease.findUnique.mockResolvedValue(row({ id: 'rel-3', isDownloadable: false }));
    tx.appRelease.update.mockResolvedValue(row({ id: 'rel-3', status: RELEASESTATUS.FAILED }));
    tx.appRelease.findFirst.mockResolvedValue(row({ id: 'rel-1', isDownloadable: true }));

    await AppReleaseService.rollbackRelease('rel-3');

    expect(tx.appRelease.update).toHaveBeenCalledTimes(1);
  });
});

describe('getDownloadUrl', () => {
  it('presigns the downloadable release with a friendly file name', async () => {
    mockPrisma.appRelease.findFirst.mockResolvedValue(
      row({ version: '1.4.0', isDownloadable: true }),
    );

    const url = await AppReleaseService.getDownloadUrl();

    expect(url).toBe('https://s3.example.com/get-signed');
    expect(mockS3.presignDownload).toHaveBeenCalledWith('apks/v1.0.0/abc/app.apk', {
      fileName: 'MapAnytime-v1.4.0.apk',
      contentType: 'application/vnd.android.package-archive',
      expiresIn: 300,
    });
  });

  it('returns null when nothing is downloadable', async () => {
    mockPrisma.appRelease.findFirst.mockResolvedValue(null);

    expect(await AppReleaseService.getDownloadUrl()).toBeNull();
  });

  it('falls back to the legacy external URL for pre-S3 releases', async () => {
    mockPrisma.appRelease.findFirst.mockResolvedValue(
      row({ s3Key: null, apkUrl: 'https://downloads.example.com/old.apk' }),
    );

    expect(await AppReleaseService.getDownloadUrl()).toBe('https://downloads.example.com/old.apk');
    expect(mockS3.presignDownload).not.toHaveBeenCalled();
  });
});

describe('helpers', () => {
  it('formats sizes the way clients display them', () => {
    expect(formatBytes(121_530_000)).toBe('115.9 MB');
    expect(formatBytes(2048)).toBe('2.0 KB');
  });

  it('never exposes the S3 key, legacy URL or uploader publicly', () => {
    const pub = toPublicRelease(row() as never) as Record<string, unknown>;

    expect(pub).not.toHaveProperty('s3Key');
    expect(pub).not.toHaveProperty('apkUrl');
    expect(pub).not.toHaveProperty('uploadedById');
    expect(pub.version).toBe('1.0.0');
  });
});
