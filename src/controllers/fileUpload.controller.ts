import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import S3Util from '../utils/s3.util';
import { responseSuccess, responseError } from '../helpers/response.helper';

export default class FileUploadController {
  static async getPresignedUploadUrl(req: Request, res: Response, next: NextFunction) {
    // Define what the frontend must send to get a ticket
    const schema = Joi.object({
      fileName: Joi.string().required(),
      mimeType: Joi.string().required(),
      folder: Joi.string().valid('compliance', 'products', 'avatars').default('compliance'),
    });

    const { error, value } = schema.validate(req.query);
    if (error) return responseError(res, 400, error.message);

    try {
      // Generate the AWS S3 URL using your new utility
      const data = await S3Util.generateUploadUrl(value.fileName, value.mimeType, value.folder);

      // Return the URL and the fileKey to the frontend
      return responseSuccess(res, 200, data, 'Presigned URL generated successfully');
    } catch (error) {
      next(error);
    }
  }
}
