import { Router } from 'express';
import { ProductsController } from '../controllers/ProductsController';
import { authenticate } from '../middleware/auth';
import { requireManager, checkManagerPermission } from '../middleware/authorize';

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /api/products/stats - Get product statistics
router.get('/stats', ProductsController.getProductStats);

// GET /api/products - Get products
router.get('/', ProductsController.getProducts);

// POST /api/products - Create product (manager+)
router.post('/', requireManager, checkManagerPermission('canCreateProducts'), ProductsController.createProduct);

// PUT /api/products?id=X - Update product (manager+)
router.put('/', requireManager, checkManagerPermission('canEditProducts'), ProductsController.updateProduct);

// DELETE /api/products?id=X - Delete product (manager+)
router.delete('/', requireManager, checkManagerPermission('canDeleteProducts'), ProductsController.deleteProduct);

// POST /api/products/restore?id=X - Restore soft-deleted product (manager+)
router.post('/restore', requireManager, checkManagerPermission('canCreateProducts'), ProductsController.restoreProduct);

export default router;

