import { PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'crypto';
import logger from '../utils/logger';
import { bucket, publicUrl, s3Client, s3Presign } from './s3.client';

/** S3 error names that mean "there is no object at this key". */
const MISSING_OBJECT_ERRORS = new Set(['NotFound', 'NoSuchKey', 'Forbidden', 'AccessDenied']);

export default class S3Util {
  // Generates a temporary URL the frontend can use to upload a file directly to S3.
  static async generateUploadUrl(
    originalFileName: string,
    mimeType: string,
    folder: string = 'documents',
  ): Promise<{ uploadUrl: string; fileKey: string }> {
    const fileExtension = originalFileName.split('.').pop();
    const randomName = crypto.randomBytes(16).toString('hex');
    const fileKey = `${folder}/${randomName}.${fileExtension}`;

    const command = new PutObjectCommand({
      Bucket: bucket(),
      Key: fileKey,
      ContentType: mimeType,
    });

    // Signed with `s3Presign`, not the operations client: this URL is handed to
    // a browser on the host, and the host it is signed against is part of the
    // signature. See s3.client.ts.
    //
    // URL expires in 15 minutes (900 seconds)
    const uploadUrl = await getSignedUrl(s3Presign, command, { expiresIn: 900 });

    logger.info(`[S3] Generated presigned upload URL for key: ${fileKey}`);

    return { uploadUrl, fileKey };
  }

  // Generates a temporary URL to view/download a private file by its S3 Key.
  static async getFileUrl(fileKey: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: bucket(),
      Key: fileKey,
    });

    // URL expires in 1 hour (3600 seconds)
    const downloadUrl = await getSignedUrl(s3Presign, command, { expiresIn: 3600 });

    return downloadUrl;
  }

  /**
   * Presigns a PUT for a key the caller has already chosen. `generateUploadUrl` picks a random
   * key; this exists for uploads whose key carries meaning (e.g. `apks/v1.2.0/...`). The browser
   * must send the same Content-Type it was signed with.
   */
  static async presignPut(key: string, contentType: string, expiresIn = 900): Promise<string> {
    const command = new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType });
    const uploadUrl = await getSignedUrl(s3Presign, command, { expiresIn });
    logger.info(`[S3] Generated presigned upload URL for key: ${key}`);
    return uploadUrl;
  }

  /**
   * Presigns a GET that the browser saves as a file rather than displays. The response headers
   * are part of the signature, so the bucket needs no per-object metadata for this to work and
   * the saved file gets `fileName` instead of the random key.
   */
  static async presignDownload(
    key: string,
    {
      fileName,
      contentType,
      expiresIn = 300,
    }: { fileName: string; contentType: string; expiresIn?: number },
  ): Promise<string> {
    const safeName = fileName.replace(/["\\\r\n]/g, '');
    const command = new GetObjectCommand({
      Bucket: bucket(),
      Key: key,
      ResponseContentDisposition: `attachment; filename="${safeName}"`,
      ResponseContentType: contentType,
    });
    return getSignedUrl(s3Presign, command, { expiresIn });
  }

  /**
   * Size and type of an object, or null if it isn't there. Uses the operations client: this is a
   * server-side call, not a URL handed to a browser.
   *
   * The runtime IAM policy grants GetObject but not ListBucket, and without ListBucket S3 answers
   * a missing key with 403 rather than 404 — so a 403 is read as "missing" too.
   */
  static async headObject(
    key: string,
  ): Promise<{ contentLength: number; contentType?: string } | null> {
    try {
      const res = await s3Client.send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
      return { contentLength: Number(res.ContentLength ?? 0), contentType: res.ContentType };
    } catch (error) {
      const name = (error as { name?: string })?.name;
      if (name && MISSING_OBJECT_ERRORS.has(name)) return null;
      throw error;
    }
  }

  /**
   * Generates an absolute public URL for a given S3 key.
   *
   * The two guards are the reason this is not just `publicUrl` re-exported:
   * callers pass columns that are nullable (`store.repository.ts` logo and
   * marker photo, `store.service.ts` logo and banner), and some rows already
   * hold an absolute URL from before keys were stored. Choosing the host is
   * `publicUrl`'s job; deciding whether a host is wanted at all is this one's.
   */
  static getPublicUrl(fileKey: string | null): string | null {
    if (!fileKey) return null;
    if (fileKey.startsWith('http')) return fileKey; // Already an absolute URL

    return publicUrl(fileKey);
  }
}
