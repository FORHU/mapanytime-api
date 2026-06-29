import { Router } from 'express';
import CategoryController from '../controllers/category.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.get('/', CategoryController.index);

// Only authenticated sellers can create new categories
router.post('/', authenticate, CategoryController.create);

export default router;
