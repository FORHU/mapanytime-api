import express from 'express';
import ProductController from './product.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = express.Router();

router.get('/all', ProductController.getAllProducts);
// Registered before the `/:id` routes so the literal path isn't swallowed as an id.
router.get('/my-categories', authenticate, ProductController.myCategories);
router.post('/', authenticate, ProductController.create);
router.get('/', authenticate, ProductController.index);
router.put('/:id', authenticate, ProductController.update);
router.delete('/:id', authenticate, ProductController.delete);

export default router;
