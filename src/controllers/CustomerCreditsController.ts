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
      let amountNum = parseFloat(amount);

      if (isNaN(customerIdNum) || isNaN(amountNum)) {
        return res.status(400).json({
          error: 'Invalid customer ID or amount',
          code: 'INVALID_DATA',
        });
      }

      // CRITICAL FIX: Validate transaction type
      const validTypes = ['credit', 'debit', 'admin_credit'];
      if (!validTypes.includes(transactionType)) {
        return res.status(400).json({
          error: 'Invalid transaction type. Must be: credit, debit, or admin_credit',
          code: 'INVALID_TRANSACTION_TYPE',
        });
      }

      // CRITICAL FIX: Enforce sign convention for data integrity
      // credit/admin_credit = customer owes us (POSITIVE amount)
      // debit = customer payment (NEGATIVE amount)
      if (transactionType === 'credit' || transactionType === 'admin_credit') {
        amountNum = Math.abs(amountNum); // Ensure positive
      } else if (transactionType === 'debit') {
        amountNum = -Math.abs(amountNum); // Ensure negative
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

  /**
   * Get customers with overdue credits based on configured due days
   */
  static async getOverdueCustomers(req: AuthRequest, res: Response) {
    try {
      // Get credit due days setting from business settings
      const settings = await prisma.businessSetting.findFirst();
      const creditDueDays = settings?.creditDueDays ?? 7;
      const enableCreditAlerts = settings?.enableCreditAlerts ?? true;

      if (!enableCreditAlerts) {
        return res.json({ overdueCustomers: [], enabled: false });
      }

      // Calculate the cutoff date
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - creditDueDays);

      // Get all customers with outstanding credit balance
      const customersWithCredit = await prisma.customerCredit.findMany({
        where: {
          createdAt: { lte: cutoffDate },
          balance: { gt: 0 }, // Only customers with positive balance (they owe us)
        },
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              phone: true,
              email: true,
            },
          },
        },
        orderBy: {
          createdAt: 'asc',
        },
      });

      // Group by customer and get the oldest credit date for each (to determine overdue duration)
      const customerBalances = new Map<number, any>();

      for (const credit of customersWithCredit) {
        const customerId = credit.customerId;
        const existingEntry = customerBalances.get(customerId);

        // Keep the OLDEST credit entry for each customer (to track when they first became overdue)
        // But use the LATEST balance for accuracy
        if (!existingEntry) {
          // First entry for this customer
          customerBalances.set(customerId, {
            customerId: credit.customerId,
            customer: credit.customer,
            balance: decimalToNumber(credit.balance) ?? 0,
            oldestCreditDate: credit.createdAt,
            daysOverdue: Math.floor(
              (new Date().getTime() - new Date(credit.createdAt).getTime()) / (1000 * 60 * 60 * 24)
            ),
          });
        } else {
          // Update with latest balance but keep oldest date
          const isOlder = new Date(credit.createdAt) < new Date(existingEntry.oldestCreditDate);
          customerBalances.set(customerId, {
            customerId: credit.customerId,
            customer: credit.customer,
            balance: decimalToNumber(credit.balance) ?? 0, // Use latest balance
            oldestCreditDate: isOlder ? credit.createdAt : existingEntry.oldestCreditDate, // Keep oldest date
            daysOverdue: Math.floor(
              (new Date().getTime() - new Date(isOlder ? credit.createdAt : existingEntry.oldestCreditDate).getTime()) / (1000 * 60 * 60 * 24)
            ),
          });
        }
      }

      // Filter customers with current positive balance and overdue
      const overdueCustomers = Array.from(customerBalances.values())
        .filter(item => item.balance > 0 && item.daysOverdue >= creditDueDays)
        .sort((a, b) => b.daysOverdue - a.daysOverdue); // Sort by most overdue first

      return res.json({
        overdueCustomers,
        creditDueDays,
        enabled: true,
        totalOverdueAmount: overdueCustomers.reduce((sum, c) => sum + c.balance, 0),
        count: overdueCustomers.length,
      });
    } catch (error) {
      console.error('Get overdue customers error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }
}

