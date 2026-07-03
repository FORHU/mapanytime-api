import express from 'express';
import FileUploadController from '../controllers/fileUpload.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = express.Router();

router.get('/presigned-url', authenticate, FileUploadController.getPresignedUploadUrl);

export default router;
