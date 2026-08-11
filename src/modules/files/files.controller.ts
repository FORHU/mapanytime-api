import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import FilesService from './files.service';
import { responseSuccess, responseError } from '../../helpers/response.helper';

export default class FilesController {
  static async create(req: Request, res: Response, next: NextFunction) {
    const schema = Joi.object({
      fileKey: Joi.string().required(),
      fileName: Joi.string().required(),
      mimeType: Joi.string().required(),
      size: Joi.number().integer().min(0).required(),
      storageProvider: Joi.string().optional(),
      bucket: Joi.string().optional(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) return responseError(res, 400, error.message);

    try {
      const userId = (req.user as { id: string })?.id;
      const file = await FilesService.createFile({
        ...value,
        ...(userId ? { uploadedById: userId } : {}),
      });

      return responseSuccess(res, 201, file, 'File record created');
    } catch (err) {
      next(err);
    }
  }
}
