import { Router } from 'express';
import { CategoriesController } from '../controllers/CategoriesController';
import { authenticate } from '../middleware/auth';
import { requireManager, checkManagerPermission, requireCashier } from '../middleware/authorize';

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /api/categories - Get categories
router.get('/', requireCashier, CategoriesController.getCategories);

// POST /api/categories - Create category
router.post('/', checkManagerPermission('canCreateCategories'), CategoriesController.createCategory);

// PUT /api/categories?id=X - Update category
router.put('/', checkManagerPermission('canEditCategories'), CategoriesController.updateCategory);

// DELETE /api/categories?id=X - Delete category
router.delete('/', checkManagerPermission('canDeleteCategories'), CategoriesController.deleteCategory);

export default router;

