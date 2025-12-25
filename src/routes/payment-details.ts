import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { decimalToNumber } from '../utils/decimal';

const router = Router();

router.use(authenticate);

// GET /api/payment-details?orderId=X - Get split / detailed payments for an order
router.get('/', async (req: any, res) => {
  try {
    const { orderId } = req.query;

    if (!orderId) {
      return res.status(400).json({
        error: 'Order ID is required',
        code: 'MISSING_ORDER_ID',
      });
    }

    const orderIdNum = parseInt(orderId as string);
    if (isNaN(orderIdNum)) {
      return res.status(400).json({
        error: 'Invalid order ID',
        code: 'INVALID_ORDER_ID',
      });
    }

    const { prisma } = await import('../models/db');

    const [payments, cheques] = await Promise.all([
      prisma.paymentDetail.findMany({
        where: { orderId: orderIdNum },
        orderBy: { id: 'asc' },
      }),
      prisma.cheque.findMany({
        where: { orderId: orderIdNum },
        orderBy: { id: 'asc' },
      }),
    ]);

    // Map cheques to any cheque payment details that are missing a reference
    let chequeIndex = 0;
    const serialized = payments.map((p) => {
      let reference = p.reference as string | null;

      if (!reference && p.paymentType === 'cheque' && chequeIndex < cheques.length) {
        reference = cheques[chequeIndex]?.chequeNumber || null;
        chequeIndex++;
      }

      return {
        ...p,
        amount: decimalToNumber(p.amount) ?? 0,
        reference,
      };
    });

    return res.json(serialized);
  } catch (error) {
    console.error('Get payment details error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  }
});

export default router;


