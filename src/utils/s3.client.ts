import { S3Client } from '@aws-sdk/client-s3';

/**
 * The S3 clients.
 *
 * ── On credentials ───────────────────────────────────────────────────────────
 *
 * In deployed environments there are none here, deliberately. The client is
 * constructed with a region and nothing else, which leaves the SDK's default
 * provider chain to find them — the EC2 instance role
 * (`production-mapanytime-instance`), which holds S3 on the bucket below.
 *
 * Passing `credentials` unconditionally defeats that: the SDK stops consulting
 * the chain the moment it is handed something, and a stale key then takes the
 * app down instead of being ignored. That is exactly how the deploy failed on
 * 2026-09-10. The `local &&` guard below is load-bearing.
 *
 * ── On the two clients ───────────────────────────────────────────────────────
 *
 * Locally, S3 is MinIO in docker-compose. The app reaches it at `minio:9000`,
 * a compose service name resolvable only inside the network — but a presigned
 * URL is handed to a browser on the host, which cannot resolve that name. The
 * host is part of what a presigned URL signs, so it cannot be rewritten after
 * the fact. Hence one client for operations and one for signing.
 *
 * In production both endpoints are unset and the two clients are identical.
 */

const local = Boolean(process.env.S3_ENDPOINT);

const credentials = local
  ? {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    }
  : undefined;

/** Everything the server does itself: put, get, delete, list. */
export const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  ...(local && {
    endpoint: process.env.S3_ENDPOINT,
    // MinIO serves buckets as a path, not as a subdomain.
    forcePathStyle: true,
    credentials,
  }),
});

/** Only for `getSignedUrl`. Signed against a host the browser can resolve. */
export const s3Presign = new S3Client({
  region: process.env.AWS_REGION,
  ...(local && {
    endpoint: process.env.S3_PUBLIC_ENDPOINT,
    forcePathStyle: true,
    credentials,
  }),
});

/**
 * The bucket, read at call time rather than at module load.
 *
 * A missing bucket should fail the one request that needed it, naming the
 * variable, rather than stopping the process from starting over a feature
 * nobody has used yet.
 */
export function bucket(): string {
  const name = process.env.AWS_S3_BUCKET_NAME;
  if (!name) {
    throw new Error('AWS_S3_BUCKET_NAME is not set.');
  }
  return name;
}

/**
 * Where a stored object can be read from.
 *
 * Upload is only half the flow: locally the object lives at
 * `http://localhost:9000/<bucket>/<key>`, not on amazonaws.com, so a URL built
 * by string-concatenating the AWS host produces uploads that succeed and images
 * that 404. Same branch as the clients above, for the same reason.
 */
export function publicUrl(key: string): string {
  if (local) {
    return `${process.env.S3_PUBLIC_ENDPOINT}/${bucket()}/${key}`;
  }
  if (process.env.S3_CDN_URL) {
    return `${process.env.S3_CDN_URL.replace(/\/$/, '')}/${key}`;
  }
  return `https://${bucket()}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
}
