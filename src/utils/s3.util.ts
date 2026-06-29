import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'crypto';
import logger from '../utils/logger';
import {
  AWS_REGION,
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
  AWS_S3_BUCKET_NAME,
  S3_CDN_URL,
} from '../config'; 

console.log("DEBUG BUCKET INITIALIZATION:", { 
  region: AWS_REGION, 
  hasKey: !!AWS_ACCESS_KEY_ID 
});

const s3Client = new S3Client({      
  region: AWS_REGION as string,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID as string,
    secretAccessKey: AWS_SECRET_ACCESS_KEY as string,
  },
});

export default class S3Util {
  static async uploadBuffer(
    file: Express.Multer.File,
    folder: string = 'documents',
  ): Promise<string> {
    const fileExtension = file.originalname.split('.').pop();
    const randomName = crypto.randomBytes(16).toString('hex');
    const key = `${folder}/${randomName}.${fileExtension}`;

    const command = new PutObjectCommand({
      Bucket: AWS_S3_BUCKET_NAME,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    });

    await s3Client.send(command);

    logger.info(`[AWS S3] Successfully uploaded ${file.originalname} to ${key}`);

    // If a CDN URL is provided in the environment, use it. Otherwise, fallback to the raw S3 URL.
    if (S3_CDN_URL) {
      return `${S3_CDN_URL}/${key}`;
    }

    return `https://${AWS_S3_BUCKET_NAME}.s3.${AWS_REGION}.amazonaws.com/${key}`;
  }
}