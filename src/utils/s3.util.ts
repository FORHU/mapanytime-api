import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'crypto';
import logger from '../utils/logger';
import { bucket, publicUrl, s3Presign } from './s3.client';

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
