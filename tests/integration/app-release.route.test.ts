import request from 'supertest';
import app from '../../src/app';

/** Compiling the app's import graph can overrun the default under a loaded suite; see rbac.auth.test.ts. */
jest.setTimeout(20000);

/**
 * The public install link and the admin release routes, end to end through Express with the
 * database and S3 mocked. Pins two things: the download is a redirect to a presigned S3 URL (the
 * bucket is never public), and nothing that writes is reachable without an admin.
 */
const findFirst = jest.fn();

jest.mock('../../src/utils/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    users: { findUnique: jest.fn().mockResolvedValue(null) },
    appRelease: { findFirst: (...args: unknown[]) => findFirst(...args) },
  },
}));

jest.mock('../../src/utils/s3.util', () => ({
  __esModule: true,
  default: {
    presignDownload: jest
      .fn()
      .mockResolvedValue(
        'https://bucket.s3.ap-southeast-1.amazonaws.com/apks/v1.0.0/abc/app.apk?X-Amz-Signature=sig',
      ),
    presignPut: jest.fn(),
    headObject: jest.fn(),
    getPublicUrl: jest.fn(),
    getFileUrl: jest.fn(),
    generateUploadUrl: jest.fn(),
  },
}));

jest.mock('../../src/infrastructure/redis', () => ({
  redis: {
    connect: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    ping: jest.fn().mockResolvedValue(true),
    getClient: jest.fn(),
  },
}));

jest.mock('../../src/infrastructure/rabbitmq', () => ({
  rabbitmq: {
    connect: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    isReady: jest.fn().mockReturnValue(true),
    publish: jest.fn().mockResolvedValue(true),
    consume: jest.fn().mockResolvedValue(undefined),
  },
}));

const downloadable = {
  id: 'rel-1',
  version: '1.0.0',
  buildNumber: 1,
  channel: 'Stable',
  fileSize: '115.9 MB',
  fileSizeBytes: 121_530_000,
  fileName: 'app.apk',
  minAndroidVersion: 'Android 8.0+',
  architecture: 'arm64-v8a',
  sha256: null,
  whatsNew: ['First release'],
  s3Key: 'apks/v1.0.0/abc/app.apk',
  apkUrl: null,
  status: 'ACTIVE',
  isDownloadable: true,
  forceUpdate: false,
  uploadedById: 'admin-1',
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
};

describe('GET /api/v1/app/download', () => {
  beforeEach(() => findFirst.mockReset());

  it('redirects to a presigned S3 URL for the downloadable version', async () => {
    findFirst.mockResolvedValue(downloadable);

    const res = await request(app).get('/api/v1/app/download');

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('amazonaws.com/apks/v1.0.0/');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('answers 404 when no version is downloadable', async () => {
    findFirst.mockResolvedValue(null);

    const res = await request(app).get('/api/v1/app/download');

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/no version/i);
  });
});

describe('GET /api/v1/app/latest', () => {
  it('reports availability without leaking the S3 key', async () => {
    findFirst.mockResolvedValue(downloadable);

    const res = await request(app).get('/api/v1/app/latest');

    expect(res.status).toBe(200);
    expect(res.body.data.available).toBe(true);
    expect(res.body.data.release.version).toBe('1.0.0');
    expect(JSON.stringify(res.body)).not.toContain('apks/');
  });
});

describe('admin release routes', () => {
  const routes: Array<{ method: 'get' | 'post' | 'patch'; path: string }> = [
    { method: 'get', path: '/api/v1/admin/app-releases' },
    { method: 'post', path: '/api/v1/admin/app-releases/upload-url' },
    { method: 'post', path: '/api/v1/admin/app-releases' },
    { method: 'patch', path: '/api/v1/admin/app-releases/rel-1' },
    { method: 'post', path: '/api/v1/admin/app-releases/rel-1/set-downloadable' },
    { method: 'post', path: '/api/v1/admin/app-releases/rel-1/rollback' },
    { method: 'get', path: '/api/v1/admin/app-releases/rel-1/download-url' },
  ];

  routes.forEach(({ method, path }) => {
    it(`${method.toUpperCase()} ${path} rejects a request without a token`, async () => {
      const res = await request(app)[method](path).send({});
      expect(res.status).toBe(401);
    });
  });
});
