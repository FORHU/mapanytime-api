import { Router } from 'express';
import CategoryController from '../controllers/category.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireAdmin } from '../middleware/admin.middleware';

const router = Router();

// GET is open to any authenticated user
router.get('/', authenticate, CategoryController.index);
// Root categories (no parent)
router.get('/root', authenticate, CategoryController.listRootCategories);
// Branch categories (have a parent)
router.get('/branch', authenticate, CategoryController.listBranchCategories);
// Full category tree (roots with nested children)
router.get('/trees', authenticate, CategoryController.listCategoryTrees);

// POST, PATCH, DELETE are strictly protected by both middlewares
router.post('/', authenticate, requireAdmin, CategoryController.create);
router.patch('/:id', authenticate, requireAdmin, CategoryController.update);
router.delete('/:id', authenticate, requireAdmin, CategoryController.destroy);

export default router;
