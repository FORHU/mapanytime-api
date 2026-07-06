import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'crypto';
import logger from '../utils/logger';
import {
  AWS_REGION,
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
  AWS_S3_BUCKET_NAME,
} from '../config';

const s3Client = new S3Client({
  region: AWS_REGION as string,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID as string,
    secretAccessKey: AWS_SECRET_ACCESS_KEY as string,
  },
});

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
      Bucket: AWS_S3_BUCKET_NAME,
      Key: fileKey,
      ContentType: mimeType,
    });

    // URL expires in 15 minutes (900 seconds)
    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 });

    logger.info(`[AWS S3] Generated presigned upload URL for key: ${fileKey}`);

    return { uploadUrl, fileKey };
  }

  // Generates a temporary URL to view/download a private file by its S3 Key.
  static async getFileUrl(fileKey: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: AWS_S3_BUCKET_NAME,
      Key: fileKey,
    });

    // URL expires in 1 hour (3600 seconds)
    const downloadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

    return downloadUrl;
  }
}
