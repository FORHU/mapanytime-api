import express from 'express';
import ProductController from './product.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = express.Router();

router.get('/all', ProductController.getAllProducts);
router.post('/', authenticate, ProductController.create);
router.get('/', authenticate, ProductController.index);
router.put('/:id', authenticate, ProductController.update);
router.delete('/:id', authenticate, ProductController.delete);

export default router;
