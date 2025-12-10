import { Response } from 'express';
import { prisma } from '../models/db';
import { AuthRequest } from '../middleware/auth';
import { decimalToNumber } from '../utils/decimal';

export class CustomerCreditsController {
  static async getCustomerCredits(req: AuthRequest, res: Response) {
    try {
      const { customerId, limit = 50 } = req.query;

      if (!customerId) {
        return res.status(400).json({
          error: 'Customer ID is required',
          code: 'MISSING_CUSTOMER_ID',
        });
      }

      const customerIdNum = parseInt(customerId as string);
      if (isNaN(customerIdNum)) {
        return res.status(400).json({
          error: 'Invalid customer ID',
          code: 'INVALID_CUSTOMER_ID',
        });
      }

      const take = Math.min(parseInt(limit as string) || 50, 1000);

      const credits = await prisma.customerCredit.findMany({
        where: {
          customerId: customerIdNum,
        },
        include: {
          user: {
            select: { id: true, fullName: true, email: true },
          },
          order: {
            select: { id: true, orderNumber: true, total: true },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take,
      });

      // Convert Decimal types to numbers
      const serialized = credits.map(credit => ({
        ...credit,
        amount: decimalToNumber(credit.amount) ?? 0,
        balance: decimalToNumber(credit.balance) ?? 0,
        order: credit.order ? {
          ...credit.order,
          total: decimalToNumber(credit.order.total) ?? 0,
        } : null,
      }));

      return res.json(serialized);
    } catch (error) {
      console.error('Get customer credits error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  static async createCredit(req: AuthRequest, res: Response) {
    try {
      const { customerId, orderId, transactionType, amount, description, userId } = req.body;

      if (!customerId || !transactionType || amount === undefined) {
        return res.status(400).json({
          error: 'Customer ID, transaction type, and amount are required',
          code: 'MISSING_REQUIRED_FIELDS',
        });
      }

      const customerIdNum = parseInt(customerId);
      const amountNum = parseFloat(amount);

      if (isNaN(customerIdNum) || isNaN(amountNum)) {
        return res.status(400).json({
          error: 'Invalid customer ID or amount',
          code: 'INVALID_DATA',
        });
      }

      // Calculate the new balance by summing all existing credits for this customer
      const existingCredits = await prisma.customerCredit.findMany({
        where: { customerId: customerIdNum },
        select: { amount: true },
        orderBy: { createdAt: 'asc' },
      });

      // Calculate running balance
      let runningBalance = 0;
      for (const credit of existingCredits) {
        runningBalance += decimalToNumber(credit.amount) ?? 0;
      }
      runningBalance += amountNum; // Add the new transaction

      const credit = await prisma.customerCredit.create({
        data: {
          customerId: customerIdNum,
          orderId: orderId ? parseInt(orderId) : null,
          transactionType,
          amount: amountNum,
          balance: runningBalance,
          description: description || null,
          userId: userId ? parseInt(userId) : req.user?.id || null,
        },
        include: {
          user: {
            select: { id: true, fullName: true, email: true },
          },
          order: {
            select: { id: true, orderNumber: true, total: true },
          },
        },
      });

      // Convert Decimal types to numbers
      const serialized = {
        ...credit,
        amount: decimalToNumber(credit.amount) ?? 0,
        balance: decimalToNumber(credit.balance) ?? 0,
        order: credit.order ? {
          ...credit.order,
          total: decimalToNumber(credit.order.total) ?? 0,
        } : null,
      };

      return res.status(201).json(serialized);
    } catch (error: any) {
      console.error('Create customer credit error:', error);

      if (error.code === 'P2003') {
        return res.status(400).json({
          error: 'Invalid customer ID or order ID',
          code: 'INVALID_REFERENCE',
        });
      }

      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }
}

