import { Router } from 'express';
import { BatchController } from '../controllers/BatchController';
import { authenticate } from '../middleware/auth';

const router = Router();

// All batch routes require authentication
router.use(authenticate);

// ========== ADMIN REPORTS ==========

// Get batch profitability report - shows which batches made how much profit
router.get('/reports/profit', BatchController.getBatchProfitReport);

// Get detailed usage of a specific batch in orders
router.get('/reports/usage', BatchController.getBatchUsageInOrders);

// Get order batch breakdown - shows all batches used in a specific order
router.get('/reports/order/:orderId', BatchController.getOrderBatchBreakdown);

// ========== BATCH MANAGEMENT ==========

// Get available batches for a specific product (for POS)
router.get('/product/:productId', BatchController.getProductBatches);

// Get batch cost analysis for a product (for admin)
router.get('/product/:productId/analysis', BatchController.getBatchCostAnalysis);

// Get all batches with filters (for admin)
router.get('/', BatchController.getAllBatches);

// Get specific batch details
router.get('/:id', BatchController.getBatchById);

export default router;
