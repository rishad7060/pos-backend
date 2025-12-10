import { Response } from 'express';
import { prisma } from '../models/db';
import { AuthRequest } from '../middleware/auth';

import { decimalToNumber } from '../utils/decimal';

export class ExpensesController {
  static async getExpenses(req: AuthRequest, res: Response) {
    try {
      const { startDate, endDate, limit = 100 } = req.query;

      const where: any = {};
      
      if (startDate || endDate) {
        where.expenseDate = {};
        if (startDate) {
          where.expenseDate.gte = new Date(startDate as string);
        }
        if (endDate) {
          const end = new Date(endDate as string);
          end.setHours(23, 59, 59, 999);
          where.expenseDate.lte = end;
        }
      }

      const expenses = await prisma.expense.findMany({
        where,
        include: {
          category: true,
          user: {
            select: { id: true, fullName: true, email: true },
          },
        },
        orderBy: {
          expenseDate: 'desc',
        },
        take: Math.min(parseInt(limit as string) || 100, 1000),
      });

      // Convert Decimal to numbers
      const serialized = expenses.map(expense => ({
        ...expense,
        amount: decimalToNumber(expense.amount) ?? 0,
      }));

      return res.json(serialized);
    } catch (error) {
      console.error('Get expenses error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  static async getSummary(req: AuthRequest, res: Response) {
    try {
      const { startDate, endDate, groupBy = 'category' } = req.query;

      if (!startDate || !endDate) {
        return res.status(400).json({
          error: 'Start date and end date are required',
          code: 'MISSING_DATES',
        });
      }

      const start = new Date(startDate as string);
      start.setHours(0, 0, 0, 0);
      const end = new Date(endDate as string);
      end.setHours(23, 59, 59, 999);

      const expenses = await prisma.expense.findMany({
        where: {
          expenseDate: {
            gte: start,
            lte: end,
          },
        },
        include: {
          category: true,
        },
      });

      if (groupBy === 'category') {
        // Group by category
        const categoryMap = new Map<number, {
          categoryId: number;
          categoryName: string;
          totalAmount: number;
          count: number;
        }>();

        expenses.forEach(expense => {
          const categoryId = expense.categoryId;
          const amount = decimalToNumber(expense.amount) ?? 0;

          if (!categoryMap.has(categoryId)) {
            categoryMap.set(categoryId, {
              categoryId,
              categoryName: expense.category?.name || 'Uncategorized',
              totalAmount: 0,
              count: 0,
            });
          }

          const categoryData = categoryMap.get(categoryId)!;
          categoryData.totalAmount += amount;
          categoryData.count += 1;
        });

        const summary = Array.from(categoryMap.values()).map(item => ({
          ...item,
          totalAmount: Number(item.totalAmount.toFixed(2)),
        })).sort((a, b) => b.totalAmount - a.totalAmount);

        return res.json(summary);
      }

      // Default: return total summary
      const totalAmount = expenses.reduce((sum, expense) => {
        return sum + (decimalToNumber(expense.amount) ?? 0);
      }, 0);

      return res.json({
        totalAmount: Number(totalAmount.toFixed(2)),
        count: expenses.length,
      });
    } catch (error: any) {
      console.error('Get expenses summary error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    }
  }

  static async createExpense(req: AuthRequest, res: Response) {
    try {
      const { categoryId, amount, description, expenseType, paymentMethod, expenseDate, notes, userId } = req.body;

      if (!categoryId || !amount || !description) {
        return res.status(400).json({
          error: 'Category ID, amount, and description are required',
          code: 'MISSING_REQUIRED_FIELDS',
        });
      }

      if (amount <= 0) {
        return res.status(400).json({
          error: 'Amount must be greater than 0',
          code: 'INVALID_AMOUNT',
        });
      }

      // Verify category exists, or create default categories if none exist
      let category = await prisma.expenseCategory.findUnique({
        where: { id: categoryId },
      });

      if (!category) {
        // Check if any categories exist at all
        const categoryCount = await prisma.expenseCategory.count();
        if (categoryCount === 0) {
          // Create default categories
          await prisma.expenseCategory.createMany({
            data: [
              { name: 'Office Supplies', description: 'Stationery and office supplies', isActive: true },
              { name: 'Utilities', description: 'Electricity, water, internet', isActive: true },
              { name: 'Rent', description: 'Monthly rent payments', isActive: true },
              { name: 'Transportation', description: 'Fuel and vehicle costs', isActive: true },
              { name: 'Marketing', description: 'Advertising and promotions', isActive: true },
            ],
            skipDuplicates: true,
          });

          // Try to find the category again after creating defaults
          category = await prisma.expenseCategory.findUnique({
            where: { id: categoryId },
          });
        }

        if (!category) {
          return res.status(400).json({
            error: 'Invalid category ID',
            code: 'INVALID_CATEGORY',
          });
        }
      }

      const expense = await prisma.expense.create({
        data: {
          categoryId,
          userId: req.user.id, // Use authenticated user's ID
          amount,
          description,
          expenseType: expenseType || 'cash_out',
          paymentMethod: paymentMethod || null,
          expenseDate: expenseDate ? new Date(expenseDate) : new Date(),
          notes: notes || null,
        },
        include: {
          category: true,
          user: {
            select: { id: true, fullName: true, email: true },
          },
        },
      });

      // Convert Decimal to number for response
      const serialized = {
        ...expense,
        amount: decimalToNumber(expense.amount) ?? 0,
      };

      return res.status(201).json(serialized);
    } catch (error: any) {
      console.error('Create expense error:', error);
      if (error.code === 'P2003') {
        return res.status(400).json({
          error: 'Invalid category or user ID',
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

  static async updateExpense(req: AuthRequest, res: Response) {
    try {
      const { id } = req.query;
      const { categoryId, amount, description, expenseType, paymentMethod, expenseDate, notes } = req.body;

      if (!id) {
        return res.status(400).json({
          error: 'Expense ID is required',
          code: 'MISSING_ID',
        });
      }

      // Verify expense exists and belongs to user (or admin)
      const existingExpense = await prisma.expense.findUnique({
        where: { id: parseInt(id as string) },
        include: { category: true },
      });

      if (!existingExpense) {
        return res.status(404).json({
          error: 'Expense not found',
          code: 'EXPENSE_NOT_FOUND',
        });
      }

      // Check if user can edit this expense (admin can edit all, others only their own)
      if (req.user.role !== 'admin' && existingExpense.userId !== req.user.id) {
        return res.status(403).json({
          error: 'You can only edit your own expenses',
          code: 'INSUFFICIENT_PERMISSIONS',
        });
      }

      // Validate category if provided
      if (categoryId) {
        const category = await prisma.expenseCategory.findUnique({
          where: { id: categoryId },
        });

        if (!category) {
          return res.status(400).json({
            error: 'Invalid category ID',
            code: 'INVALID_CATEGORY',
          });
        }
      }

      // Validate amount if provided
      if (amount !== undefined && amount <= 0) {
        return res.status(400).json({
          error: 'Amount must be greater than 0',
          code: 'INVALID_AMOUNT',
        });
      }

      const updateData: any = {};
      if (categoryId !== undefined) updateData.categoryId = categoryId;
      if (amount !== undefined) updateData.amount = amount;
      if (description !== undefined) updateData.description = description;
      if (expenseType !== undefined) updateData.expenseType = expenseType;
      if (paymentMethod !== undefined) updateData.paymentMethod = paymentMethod;
      if (expenseDate !== undefined) updateData.expenseDate = new Date(expenseDate);
      if (notes !== undefined) updateData.notes = notes;

      const expense = await prisma.expense.update({
        where: { id: parseInt(id as string) },
        data: updateData,
        include: {
          category: true,
          user: {
            select: { id: true, fullName: true, email: true },
          },
        },
      });

      // Convert Decimal to number for response
      const serialized = {
        ...expense,
        amount: decimalToNumber(expense.amount) ?? 0,
      };

      return res.json(serialized);
    } catch (error: any) {
      console.error('Update expense error:', error);
      if (error.code === 'P2003') {
        return res.status(400).json({
          error: 'Invalid category or user ID',
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

  static async deleteExpense(req: AuthRequest, res: Response) {
    try {
      const { id } = req.query;

      if (!id) {
        return res.status(400).json({
          error: 'Expense ID is required',
          code: 'MISSING_ID',
        });
      }

      // Verify expense exists and belongs to user (or admin)
      const existingExpense = await prisma.expense.findUnique({
        where: { id: parseInt(id as string) },
      });

      if (!existingExpense) {
        return res.status(404).json({
          error: 'Expense not found',
          code: 'EXPENSE_NOT_FOUND',
        });
      }

      // Check if user can delete this expense (admin can delete all, others only their own)
      if (req.user.role !== 'admin' && existingExpense.userId !== req.user.id) {
        return res.status(403).json({
          error: 'You can only delete your own expenses',
          code: 'INSUFFICIENT_PERMISSIONS',
        });
      }

      await prisma.expense.delete({
        where: { id: parseInt(id as string) },
      });

      return res.json({ success: true });
    } catch (error: any) {
      console.error('Delete expense error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    }
  }

  static async getFinancialSummary(req: AuthRequest, res: Response) {
    try {
      const { startDate, endDate } = req.query;

      if (!startDate || !endDate) {
        return res.status(400).json({
          error: 'Start date and end date are required',
          code: 'MISSING_DATES',
        });
      }

      const start = new Date(startDate as string);
      start.setHours(0, 0, 0, 0);
      const end = new Date(endDate as string);
      end.setHours(23, 59, 59, 999);

      // === SALES DATA ===
      const orders = await prisma.order.findMany({
        where: {
          status: 'completed',
          createdAt: {
            gte: start,
            lte: end,
          },
        },
        include: {
          paymentDetails: true,
        },
      });

      // Calculate sales totals
      let totalSales = 0;
      let cashSales = 0;
      let cardSales = 0;
      let otherSales = 0;
      let totalOrders = orders.length;

      orders.forEach(order => {
        const orderTotal = decimalToNumber(order.total) ?? 0;
        totalSales += orderTotal;

        if (order.paymentMethod === 'cash') {
          cashSales += orderTotal;
        } else if (order.paymentMethod === 'card') {
          cardSales += orderTotal;
        } else {
          otherSales += orderTotal;
        }
      });

      const averageOrderValue = totalOrders > 0 ? totalSales / totalOrders : 0;

      // === MANUAL TRANSACTIONS (EXPENSES & INCOME) ===
      const manualTransactions = await prisma.expense.findMany({
        where: {
          expenseDate: {
            gte: start,
            lte: end,
          },
        },
        include: {
          category: true,
        },
      });

      // Separate expenses and income
      const manualExpenses = manualTransactions.filter(t => t.expenseType === 'cash_out' || t.expenseType === 'petty_cash');
      const manualIncome = manualTransactions.filter(t => t.expenseType === 'cash_in');

      const totalManualExpenses = manualExpenses.reduce((sum, expense) => {
        return sum + (decimalToNumber(expense.amount) ?? 0);
      }, 0);

      const totalManualIncome = manualIncome.reduce((sum, income) => {
        return sum + (decimalToNumber(income.amount) ?? 0);
      }, 0);

      // === CASH OUT TRANSACTIONS ===
      const cashOutTransactions = await prisma.cashTransaction.findMany({
        where: {
          transactionType: 'cash_out',
          createdAt: {
            gte: start,
            lte: end,
          },
        },
      });

      const totalCashOut = cashOutTransactions.reduce((sum, transaction) => {
        return sum + (decimalToNumber(transaction.amount) ?? 0);
      }, 0);

      // === PURCHASE ORDERS (COGS) ===
      const purchases = await prisma.purchase.findMany({
        where: {
          createdAt: {
            gte: start,
            lte: end,
          },
        },
        include: {
          supplier: {
            select: { name: true },
          },
        },
      });

      const totalPurchases = purchases.reduce((sum, purchase) => {
        return sum + (decimalToNumber(purchase.total) ?? 0);
      }, 0);

      // === FINANCIAL CALCULATIONS ===
      const cogs = totalPurchases; // Cost of Goods Sold
      const operatingExpenses = totalManualExpenses + totalCashOut;
      const totalExpenses = operatingExpenses + cogs;

      // Total revenue includes sales + manual income
      const totalRevenue = totalSales + totalManualIncome;

      const grossProfit = totalSales - cogs;
      const netProfit = totalRevenue - totalExpenses;
      const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;
      const expenseRatio = totalRevenue > 0 ? (totalExpenses / totalRevenue) * 100 : 0;

      // === BREAKDOWNS ===

      // Transaction breakdown by category (income and expenses)
      const transactionByCategory = new Map<number, {
        categoryId: number;
        categoryName: string;
        totalIncome: number;
        totalExpenses: number;
        incomeCount: number;
        expenseCount: number;
        netAmount: number;
      }>();

      manualTransactions.forEach(transaction => {
        const categoryId = transaction.categoryId;
        const amount = decimalToNumber(transaction.amount) ?? 0;
        const isIncome = transaction.expenseType === 'cash_in';

        if (!transactionByCategory.has(categoryId)) {
          transactionByCategory.set(categoryId, {
            categoryId,
            categoryName: transaction.category?.name || 'Uncategorized',
            totalIncome: 0,
            totalExpenses: 0,
            incomeCount: 0,
            expenseCount: 0,
            netAmount: 0,
          });
        }

        const categoryData = transactionByCategory.get(categoryId)!;
        if (isIncome) {
          categoryData.totalIncome += amount;
          categoryData.incomeCount += 1;
        } else {
          categoryData.totalExpenses += amount;
          categoryData.expenseCount += 1;
        }
        categoryData.netAmount = categoryData.totalIncome - categoryData.totalExpenses;
      });

      // Cash out breakdown by reason
      const cashOutByReason = new Map<string, {
        reason: string;
        totalAmount: number;
        count: number;
      }>();

      cashOutTransactions.forEach(transaction => {
        const reason = transaction.reason;
        const amount = decimalToNumber(transaction.amount) ?? 0;

        if (!cashOutByReason.has(reason)) {
          cashOutByReason.set(reason, {
            reason,
            totalAmount: 0,
            count: 0,
          });
        }

        const reasonData = cashOutByReason.get(reason)!;
        reasonData.totalAmount += amount;
        reasonData.count += 1;
      });

      // Purchase breakdown by supplier
      const purchasesBySupplier = new Map<number, {
        supplierId: number;
        supplierName: string;
        totalAmount: number;
        count: number;
      }>();

      purchases.forEach(purchase => {
        const supplierId = purchase.supplierId;
        const amount = decimalToNumber(purchase.total) ?? 0;

        if (!purchasesBySupplier.has(supplierId)) {
          purchasesBySupplier.set(supplierId, {
            supplierId,
            supplierName: purchase.supplier?.name || 'Unknown Supplier',
            totalAmount: 0,
            count: 0,
          });
        }

        const supplierData = purchasesBySupplier.get(supplierId)!;
        supplierData.totalAmount += amount;
        supplierData.count += 1;
      });

      // === COMPILE RESPONSE ===
      const response = {
        dateRange: {
          startDate: start.toISOString().split('T')[0],
          endDate: end.toISOString().split('T')[0],
        },

        // Key Financial Metrics
        financialMetrics: {
          totalRevenue: Number(totalRevenue.toFixed(2)),
          totalSales: Number(totalSales.toFixed(2)),
          totalIncome: Number(totalManualIncome.toFixed(2)),
          totalExpenses: Number(totalExpenses.toFixed(2)),
          grossProfit: Number(grossProfit.toFixed(2)),
          netProfit: Number(netProfit.toFixed(2)),
          profitMargin: Number(profitMargin.toFixed(2)),
          expenseRatio: Number(expenseRatio.toFixed(2)),
          averageOrderValue: Number(averageOrderValue.toFixed(2)),
        },

        // Sales Breakdown
        salesBreakdown: {
          totalOrders,
          cashSales: Number(cashSales.toFixed(2)),
          cardSales: Number(cardSales.toFixed(2)),
          otherSales: Number(otherSales.toFixed(2)),
        },

        // Expense Breakdown
        expenseBreakdown: {
          totalManualExpenses: Number(totalManualExpenses.toFixed(2)),
          totalManualIncome: Number(totalManualIncome.toFixed(2)),
          totalCashOut: Number(totalCashOut.toFixed(2)),
          totalPurchases: Number(totalPurchases.toFixed(2)),
          operatingExpenses: Number(operatingExpenses.toFixed(2)),
          cogs: Number(cogs.toFixed(2)),
        },

        // Detailed Breakdowns
        breakdowns: {
          transactionByCategory: Array.from(transactionByCategory.values()).map(item => ({
            ...item,
            totalIncome: Number(item.totalIncome.toFixed(2)),
            totalExpenses: Number(item.totalExpenses.toFixed(2)),
            netAmount: Number(item.netAmount.toFixed(2)),
          })).sort((a, b) => Math.abs(b.netAmount) - Math.abs(a.netAmount)),

          cashOutByReason: Array.from(cashOutByReason.values()).map(item => ({
            ...item,
            totalAmount: Number(item.totalAmount.toFixed(2)),
          })).sort((a, b) => b.totalAmount - a.totalAmount),

          purchasesBySupplier: Array.from(purchasesBySupplier.values()).map(item => ({
            ...item,
            totalAmount: Number(item.totalAmount.toFixed(2)),
          })).sort((a, b) => b.totalAmount - a.totalAmount),
        },

        // Counts
        counts: {
          totalOrders,
          totalManualExpenses: manualExpenses.length,
          totalCashOutTransactions: cashOutTransactions.length,
          totalPurchases: purchases.length,
        },
      };

      return res.json(response);
    } catch (error: any) {
      console.error('Get financial summary error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    }
  }
}

export class ExpenseCategoriesController {
  static async getCategories(req: AuthRequest, res: Response) {
    try {
      const categories = await prisma.expenseCategory.findMany({
        where: {
          isActive: true,
        },
        orderBy: {
          name: 'asc',
        },
      });

      return res.json(categories);
    } catch (error: any) {
      console.error('Get expense categories error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    }
  }

  static async createCategory(req: AuthRequest, res: Response) {
    try {
      const { name, description } = req.body;

      if (!name || !name.trim()) {
        return res.status(400).json({
          error: 'Category name is required',
          code: 'MISSING_NAME',
        });
      }

      const category = await prisma.expenseCategory.create({
        data: {
          name: name.trim(),
          description: description || null,
          isActive: true,
        },
      });

      return res.status(201).json(category);
    } catch (error: any) {
      console.error('Create expense category error:', error);
      if (error.code === 'P2002') {
        return res.status(400).json({
          error: 'Category with this name already exists',
          code: 'DUPLICATE_CATEGORY',
        });
      }
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    }
  }

  static async updateCategory(req: AuthRequest, res: Response) {
    try {
      const { id } = req.query;
      const { name, description, isActive } = req.body;

      if (!id) {
        return res.status(400).json({
          error: 'Category ID is required',
          code: 'MISSING_ID',
        });
      }

      // Verify category exists
      const existingCategory = await prisma.expenseCategory.findUnique({
        where: { id: parseInt(id as string) },
      });

      if (!existingCategory) {
        return res.status(404).json({
          error: 'Category not found',
          code: 'CATEGORY_NOT_FOUND',
        });
      }

      // Validate name if provided
      if (name !== undefined && (!name || !name.trim())) {
        return res.status(400).json({
          error: 'Category name cannot be empty',
          code: 'INVALID_NAME',
        });
      }

      const updateData: any = {};
      if (name !== undefined) updateData.name = name.trim();
      if (description !== undefined) updateData.description = description;
      if (isActive !== undefined) updateData.isActive = isActive;

      const category = await prisma.expenseCategory.update({
        where: { id: parseInt(id as string) },
        data: updateData,
      });

      return res.json(category);
    } catch (error: any) {
      console.error('Update expense category error:', error);
      if (error.code === 'P2002') {
        return res.status(400).json({
          error: 'Category with this name already exists',
          code: 'DUPLICATE_CATEGORY',
        });
      }
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    }
  }

  static async deleteCategory(req: AuthRequest, res: Response) {
    try {
      const { id } = req.query;

      if (!id) {
        return res.status(400).json({
          error: 'Category ID is required',
          code: 'MISSING_ID',
        });
      }

      // Verify category exists
      const existingCategory = await prisma.expenseCategory.findUnique({
        where: { id: parseInt(id as string) },
        include: {
          _count: {
            select: { expenses: true },
          },
        },
      });

      if (!existingCategory) {
        return res.status(404).json({
          error: 'Category not found',
          code: 'CATEGORY_NOT_FOUND',
        });
      }

      // Check if category has expenses
      if (existingCategory._count.expenses > 0) {
        return res.status(400).json({
          error: 'Cannot delete category with existing expenses',
          code: 'CATEGORY_HAS_EXPENSES',
        });
      }

      await prisma.expenseCategory.delete({
        where: { id: parseInt(id as string) },
      });

      return res.json({ success: true });
    } catch (error: any) {
      console.error('Delete expense category error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    }
  }
}

