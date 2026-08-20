import express from 'express';
import CategoryController from './category.controller';
import { authenticate } from '../../middleware/auth.middleware';
import { requireAdmin } from '../../middleware/admin.middleware';

const router = express.Router();

// The category tree is platform taxonomy every store and product hangs off.
// `authenticate` alone let any signed-in user add, rename or delete a category.
router.post('/', authenticate, requireAdmin, CategoryController.create);
router.get('/', CategoryController.index);
router.get('/roots', CategoryController.listRootCategories);
router.get('/branches', CategoryController.listBranchCategories);
router.get('/trees', CategoryController.listCategoryTrees);
router.put('/:id', authenticate, requireAdmin, CategoryController.update);
router.delete('/:id', authenticate, requireAdmin, CategoryController.destroy);

export default router;
