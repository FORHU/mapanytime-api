import express from 'express';
import ProductController from '../controllers/product.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = express.Router();

router.use(authenticate); // Protect all product routes
router.post('/', ProductController.create);
router.get('/', ProductController.index);

export default router;
