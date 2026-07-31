import express from 'express';
import CategoryController from './category.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = express.Router();

router.post('/', authenticate, CategoryController.create);
router.get('/', CategoryController.index);
router.get('/roots', CategoryController.listRootCategories);
router.get('/branches', CategoryController.listBranchCategories);
router.get('/trees', CategoryController.listCategoryTrees);
router.put('/:id', authenticate, CategoryController.update);
router.delete('/:id', authenticate, CategoryController.destroy);

export default router;
