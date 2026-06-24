import express from 'express';
import StoreController from '../controllers/store.controller';

const router = express.Router();

router.get('/nearby', StoreController.getNearby); // Public route

export default router;
