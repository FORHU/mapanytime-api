import express from 'express';
import FilesController from './files.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = express.Router();

router.post('/', authenticate, FilesController.create);

export default router;
