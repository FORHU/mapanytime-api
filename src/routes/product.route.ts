import express from 'express';
import ProductController from '../controllers/product.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = express.Router();

router.use(authenticate);
router.post('/', ProductController.create);
router.get('/', ProductController.index);
router.put('/:id', ProductController.update);
router.delete('/:id', ProductController.delete);

export default router;
