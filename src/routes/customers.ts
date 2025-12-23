import { Router } from 'express';
import { CustomersController } from '../controllers/CustomersController';
import { authenticate } from '../middleware/auth';
import { requireManager, requireCashier, checkManagerPermission, checkPermission } from '../middleware/authorize';

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /api/customers - Get customers (must come before /:id to avoid conflicts)
router.get('/', CustomersController.getCustomers);

// GET /api/customers/:id - Get customer by ID
router.get('/:id', CustomersController.getCustomerById);

// POST /api/customers - Create customer (manager or cashier with permission)
router.post('/', requireCashier, checkPermission('canCreateCustomers'), CustomersController.createCustomer);

// PUT /api/customers?id=X - Update customer (manager+)
router.put('/', requireManager, checkManagerPermission('canEditCustomers'), CustomersController.updateCustomer);

// POST /api/customers/credit - Add manual credit transaction (manager+)
router.post('/credit', requireManager, checkManagerPermission('canEditCustomers'), CustomersController.addManualCredit);

// DELETE /api/customers?id=X - Delete customer (manager+)
router.delete('/', requireManager, checkManagerPermission('canDeleteCustomers'), CustomersController.deleteCustomer);

// POST /api/customers/restore?id=X - Restore soft-deleted customer (manager+)
router.post('/restore', requireManager, checkManagerPermission('canCreateCustomers'), CustomersController.restoreCustomer);

export default router;

