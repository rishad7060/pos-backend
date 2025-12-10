import { Router } from 'express';
import { SuppliersController } from '../controllers/SuppliersController';
import { authenticate } from '../middleware/auth';
import { requireManager, checkManagerPermission } from '../middleware/authorize';

const router = Router();

// All routes require authentication and manager role
router.use(authenticate);
router.use(requireManager);

// GET /api/suppliers - Get suppliers
router.get('/', checkManagerPermission('canViewSuppliers'), SuppliersController.getSuppliers);

// POST /api/suppliers - Create supplier
router.post('/', checkManagerPermission('canCreateSuppliers'), SuppliersController.createSupplier);

// PUT /api/suppliers?id=X - Update supplier
router.put('/', checkManagerPermission('canEditSuppliers'), SuppliersController.updateSupplier);

// DELETE /api/suppliers?id=X - Delete supplier
router.delete('/', checkManagerPermission('canDeleteSuppliers'), SuppliersController.deleteSupplier);

export default router;

