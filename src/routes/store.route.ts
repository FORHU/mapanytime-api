import express from 'express';
import StoreController from '../controllers/store.controller';
import { uploadStoreDocuments } from '../middleware/upload.middleware';
import { authenticate } from '../middleware/auth.middleware';

const router = express.Router();

router.get('/nearby', StoreController.getNearby);
router.get('/my-stores', authenticate, StoreController.getMyStores);

router.post('/', authenticate, uploadStoreDocuments, StoreController.createStore);

export default router;
