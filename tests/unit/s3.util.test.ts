/**
 * Presigning is pure local crypto — no AWS call, no network — so these run
 * against dummy credentials and assert on the URL the SDK produces.
 *
 * Two shapes matter, and they are mutually exclusive: `S3_ENDPOINT` set means
 * local MinIO, unset means real S3. `src/utils/s3.client.ts` resolves that at
 * module load, so each block sets the environment and *then* imports, with
 * `jest.resetModules()` between so the second import re-evaluates rather than
 * returning the first block's cached clients.
 */

const AWS_ENV = {
  AWS_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
  AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  AWS_REGION: 'ap-southeast-1',
  AWS_S3_BUCKET_NAME: 'test-bucket',
};

type S3UtilModule = typeof import('../../src/utils/s3.util').default;

/** Clear every variable the client branches on, then apply `env`. */
const loadWith = async (env: Record<string, string>): Promise<S3UtilModule> => {
  jest.resetModules();
  for (const key of [
    'S3_ENDPOINT',
    'S3_PUBLIC_ENDPOINT',
    'S3_FORCE_PATH_STYLE',
    'S3_CDN_URL',
    ...Object.keys(AWS_ENV),
  ]) {
    delete process.env[key];
  }
  Object.assign(process.env, env);
  return (await import('../../src/utils/s3.util')).default;
};

describe('S3Util against local MinIO', () => {
  let S3Util: S3UtilModule;

  beforeEach(async () => {
    S3Util = await loadWith({
      ...AWS_ENV,
      S3_ENDPOINT: 'http://minio:9000',
      S3_PUBLIC_ENDPOINT: 'http://localhost:9000',
      S3_FORCE_PATH_STYLE: 'true',
    });
  });

  /**
   * The whole point of the two-client split. A URL signed against the internal
   * compose hostname reaches a browser that cannot resolve `minio`, and the
   * host is inside the signature, so it cannot be patched up afterwards.
   */
  it('signs the upload URL against the host the browser can reach', async () => {
    const { uploadUrl } = await S3Util.generateUploadUrl('photo.jpg', 'image/jpeg', 'products');
    const url = new URL(uploadUrl);

    expect(url.host).toBe('localhost:9000');
    expect(uploadUrl).not.toContain('minio:9000');
    expect(uploadUrl).not.toContain('amazonaws.com');
  });

  it('addresses the bucket as a path, not a subdomain', async () => {
    const { uploadUrl, fileKey } = await S3Util.generateUploadUrl(
      'photo.jpg',
      'image/jpeg',
      'products',
    );

    // MinIO serves path-style; virtual-host style would need per-bucket DNS.
    expect(new URL(uploadUrl).pathname).toBe(`/test-bucket/${fileKey}`);
  });

  it('signs download URLs against the browser-reachable host too', async () => {
    const url = new URL(await S3Util.getFileUrl('products/abc.jpg'));

    expect(url.host).toBe('localhost:9000');
    expect(url.pathname).toBe('/test-bucket/products/abc.jpg');
  });

  it('builds public URLs off MinIO rather than amazonaws.com', async () => {
    // Uploading to MinIO but reading from S3 is the failure this guards: the
    // PUT succeeds and every image 404s.
    expect(S3Util.getPublicUrl('products/abc.jpg')).toBe(
      'http://localhost:9000/test-bucket/products/abc.jpg',
    );
  });
});

describe('S3Util against real S3', () => {
  let S3Util: S3UtilModule;

  beforeEach(async () => {
    S3Util = await loadWith(AWS_ENV);
  });

  it('signs against the AWS host in virtual-host style', async () => {
    const { uploadUrl, fileKey } = await S3Util.generateUploadUrl(
      'photo.jpg',
      'image/jpeg',
      'products',
    );
    const url = new URL(uploadUrl);

    expect(url.hostname).toBe('test-bucket.s3.ap-southeast-1.amazonaws.com');
    expect(url.pathname).toBe(`/${fileKey}`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
  });

  it('builds public URLs on the AWS host', async () => {
    expect(S3Util.getPublicUrl('products/abc.jpg')).toBe(
      'https://test-bucket.s3.ap-southeast-1.amazonaws.com/products/abc.jpg',
    );
  });

  it('prefers the CDN origin when one is configured', async () => {
    S3Util = await loadWith({ ...AWS_ENV, S3_CDN_URL: 'https://cdn.example.com/' });

    expect(S3Util.getPublicUrl('products/abc.jpg')).toBe(
      'https://cdn.example.com/products/abc.jpg',
    );
  });
});

describe('S3Util.getPublicUrl guards', () => {
  let S3Util: S3UtilModule;

  beforeEach(async () => {
    S3Util = await loadWith(AWS_ENV);
  });

  /**
   * `store.repository.ts` and `store.service.ts` pass nullable columns — a
   * store with no logo is ordinary, not an error.
   */
  it('passes null through instead of building a URL for nothing', () => {
    expect(S3Util.getPublicUrl(null)).toBeNull();
    expect(S3Util.getPublicUrl('')).toBeNull();
  });

  it('leaves an already-absolute URL alone', () => {
    // Some rows predate storing bare keys.
    const absolute = 'https://images.unsplash.com/photo-123';
    expect(S3Util.getPublicUrl(absolute)).toBe(absolute);
  });
});

describe('S3Util key shape', () => {
  let S3Util: S3UtilModule;

  beforeEach(async () => {
    S3Util = await loadWith(AWS_ENV);
  });

  it('keys the object as {folder}/{32-hex}.{ext}', async () => {
    const { fileKey } = await S3Util.generateUploadUrl('photo.jpg', 'image/jpeg', 'products');

    expect(fileKey).toMatch(/^products\/[0-9a-f]{32}\.jpg$/);
  });

  it('gives two uploads of the same filename distinct keys', async () => {
    const a = await S3Util.generateUploadUrl('photo.jpg', 'image/jpeg', 'products');
    const b = await S3Util.generateUploadUrl('photo.jpg', 'image/jpeg', 'products');

    expect(a.fileKey).not.toBe(b.fileKey);
  });
});
