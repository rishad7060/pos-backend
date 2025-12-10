import { Router } from 'express';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

// GET /api/payment-details?orderId=X - Get payment details for an order
router.get('/', async (req: any, res) => {
  try {
    const { orderId } = req.query;
    
    if (!orderId) {
      return res.status(400).json({
        error: 'Order ID is required',
        code: 'MISSING_ORDER_ID',
      });
    }

    // Return payment details from order
    const { prisma } = await import('../models/db');
    const order = await prisma.order.findUnique({
      where: { id: parseInt(orderId as string) },
      select: {
        id: true,
        orderNumber: true,
        paymentMethod: true,
        cashReceived: true,
        changeGiven: true,
        total: true,
        createdAt: true,
      },
    });

    if (!order) {
      return res.status(404).json({
        error: 'Order not found',
        code: 'ORDER_NOT_FOUND',
      });
    }

    return res.json(order);
  } catch (error) {
    console.error('Get payment details error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  }
});

export default router;


