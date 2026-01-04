import { Response } from 'express';
import { prisma } from '../models/db';
import { AuthRequest } from '../middleware/auth';
import { decimalToNumber } from '../utils/decimal';
import { parseLimit, getPaginationParams } from '../config/pagination';

export class CustomerCreditsController {
  /**
   * Get customer credit history
   */
  static async getCustomerCredits(req: AuthRequest, res: Response) {
    try {
      const { customerId, limit } = req.query;

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

      const take = Math.min(parseLimit(limit, 'customerCredits'), 1000);

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

  /**
   * Create credit transaction
   * IMPORTANT: Uses correct schema transaction types
   */
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

      // CORRECTED: Use schema-defined transaction types
      // admin_adjustment = Customer debt to admin (old books, not from POS sales)
      // credit_added = Unpaid POS order (counts as revenue)
      // credit_used = Payment received
      // credit_refunded = Refund to customer credit
      const validTypes = ['credit_added', 'credit_used', 'credit_refunded', 'admin_adjustment'];
      if (!validTypes.includes(transactionType)) {
        return res.status(400).json({
          error: 'Invalid transaction type. Must be: credit_added, credit_used, credit_refunded, or admin_adjustment',
          code: 'INVALID_TRANSACTION_TYPE',
        });
      }

      if (amountNum <= 0) {
        return res.status(400).json({
          error: 'Amount must be greater than 0',
          code: 'INVALID_AMOUNT',
        });
      }

      // Get customer current balance
      const customer = await prisma.customer.findUnique({
        where: { id: customerIdNum },
      });

      if (!customer) {
        return res.status(404).json({
          error: 'Customer not found',
          code: 'CUSTOMER_NOT_FOUND',
        });
      }

      // Calculate ACTUAL balance from all transactions (don't trust customer.creditBalance as it might be stale)
      const allTransactions = await prisma.customerCredit.findMany({
        where: { customerId: customerIdNum },
        orderBy: { createdAt: 'asc' },
      });

      let currentBalance = 0;
      for (const txn of allTransactions) {
        const txnAmount = decimalToNumber(txn.amount) ?? 0;
        if (txn.transactionType === 'credit_added' || txn.transactionType === 'credit_refunded' || txn.transactionType === 'admin_adjustment') {
          currentBalance += txnAmount;
        } else if (txn.transactionType === 'credit_used') {
          currentBalance -= txnAmount;
        }
      }

      let newBalance = currentBalance;

      // Calculate new balance based on transaction type
      // admin_adjustment: Customer owes us (add to balance - customer debt)
      // credit_added: Unpaid order (add to balance - customer debt)
      // credit_refunded: Refund to customer (add to balance - we owe them)
      // credit_used: Payment received (subtract from balance - debt reduced)
      if (transactionType === 'credit_added' || transactionType === 'credit_refunded' || transactionType === 'admin_adjustment') {
        newBalance = currentBalance + amountNum;
      } else if (transactionType === 'credit_used') {
        newBalance = currentBalance - amountNum;
        if (newBalance < 0) {
          return res.status(400).json({
            error: 'Insufficient credit balance',
            code: 'INSUFFICIENT_CREDIT',
          });
        }
      }

      // Create credit transaction
      const credit = await prisma.customerCredit.create({
        data: {
          customerId: customerIdNum,
          orderId: orderId ? parseInt(orderId) : null,
          transactionType,
          amount: amountNum,
          balance: newBalance,
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

      // Update customer balance
      await prisma.customer.update({
        where: { id: customerIdNum },
        data: { creditBalance: newBalance },
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
        message: error.message,
      });
    }
  }

  /**
   * Get all customers with credit balances
   */
  static async getCustomersWithCredit(req: AuthRequest, res: Response) {
    try {
      const customers = await prisma.customer.findMany({
        where: {
          creditBalance: { gt: 0 },
          deletedAt: null,
        },
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          creditBalance: true,
          totalPurchases: true,
          visitCount: true,
          createdAt: true,
        },
        orderBy: {
          creditBalance: 'desc',
        },
      });

      const serialized = customers.map(customer => ({
        ...customer,
        creditBalance: decimalToNumber(customer.creditBalance) ?? 0,
        totalPurchases: decimalToNumber(customer.totalPurchases) ?? 0,
      }));

      return res.json(serialized);
    } catch (error) {
      console.error('Get customers with credit error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * Get credit summary report
   */
  static async getCreditSummary(req: AuthRequest, res: Response) {
    try {
      const { startDate, endDate } = req.query;

      const where: any = {};

      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) {
          where.createdAt.gte = new Date(startDate as string);
        }
        if (endDate) {
          const end = new Date(endDate as string);
          end.setHours(23, 59, 59, 999);
          where.createdAt.lte = end;
        }
      }

      // Get all credit transactions in period
      const credits = await prisma.customerCredit.findMany({
        where,
        include: {
          customer: {
            select: { name: true },
          },
        },
      });

      // Calculate totals - SEPARATE admin adjustments from POS credit sales for finance accuracy
      const posCreditSales = credits.filter(c => c.transactionType === 'credit_added'); // POS orders (counts as revenue)
      const adminAdjustments = credits.filter(c => c.transactionType === 'admin_adjustment'); // Old debts (NOT revenue)
      const paymentsReceived = credits.filter(c => c.transactionType === 'credit_used');
      const refunds = credits.filter(c => c.transactionType === 'credit_refunded');

      const totalPOSCreditSales = posCreditSales.reduce((sum, c) => sum + (decimalToNumber(c.amount) ?? 0), 0);
      const totalAdminAdjustments = adminAdjustments.reduce((sum, c) => sum + (decimalToNumber(c.amount) ?? 0), 0);
      const totalPaymentsReceived = paymentsReceived.reduce((sum, c) => sum + (decimalToNumber(c.amount) ?? 0), 0);
      const totalRefunds = refunds.reduce((sum, c) => sum + (decimalToNumber(c.amount) ?? 0), 0);

      // Get current total outstanding credits
      const customersWithCredit = await prisma.customer.findMany({
        where: {
          creditBalance: { gt: 0 },
          deletedAt: null,
        },
      });

      const totalOutstanding = customersWithCredit.reduce((sum, c) => sum + (decimalToNumber(c.creditBalance) ?? 0), 0);

      return res.json({
        summary: {
          // For FINANCE/REVENUE reporting - excludes admin adjustments
          totalPOSCreditSales: Number(totalPOSCreditSales.toFixed(2)), // Actual POS revenue
          totalPaymentsReceived: Number(totalPaymentsReceived.toFixed(2)), // Cash collected

          // For ACCOUNTS RECEIVABLE tracking - includes everything
          totalAdminAdjustments: Number(totalAdminAdjustments.toFixed(2)), // Old debts (not revenue)
          totalRefunds: Number(totalRefunds.toFixed(2)), // Refunds issued
          totalOutstanding: Number(totalOutstanding.toFixed(2)), // Total AR balance
          customersWithCredit: customersWithCredit.length,
        },
        // Transaction counts
        posCreditSalesCount: posCreditSales.length,
        adminAdjustmentsCount: adminAdjustments.length,
        paymentsReceivedCount: paymentsReceived.length,
        refundsCount: refunds.length,
      });
    } catch (error) {
      console.error('Get credit summary error:', error);
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

