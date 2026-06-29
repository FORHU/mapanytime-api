import express from 'express';
import StoreController from '../controllers/store.controller';
import { upload } from '../middleware/upload.middleware';
import { authenticate } from '../middleware/auth.middleware';

const router = express.Router();

router.get('/nearby', StoreController.getNearby);

router.post(
  '/',
  authenticate,
  upload.fields([
    { name: 'mayorsPermit', maxCount: 1 },
    { name: 'tinId', maxCount: 1 },
    { name: 'dtiCertificate', maxCount: 1 },
    { name: 'govId', maxCount: 1 },
  ]),
  StoreController.createStore,
);

export default router;
