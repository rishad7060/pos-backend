import { Response } from 'express';
import { prisma } from '../models/db';
import { AuthRequest } from '../middleware/auth';
import { decimalToNumber } from '../utils/decimal';
import { parseLimit, getPaginationParams } from '../config/pagination';

export class ReportsController {
  static async getProfitAnalysis(req: AuthRequest, res: Response) {
    try {
      const { startDate, endDate, limit } = req.query;

      // Parse dates
      const start = startDate ? new Date(startDate as string) : new Date(0);
      const end = endDate ? new Date(endDate as string) : new Date();
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);

      // Get orders in date range with order items
      const orders = await prisma.order.findMany({
        where: {
          status: 'completed',
          createdAt: {
            gte: start,
            lte: end,
          },
        },
        include: {
          orderItems: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      // Calculate limit
      const limitNum = Math.min(parseLimit(limit, 'orders'), 1000);

      // 1. PRODUCT PROFIT ANALYSIS: Aggregate by product
      const productProfitMap = new Map<number | string, {
        productId: number | null;
        productName: string;
        totalQuantitySold: number;
        totalRevenue: number;
        totalCost: number;
        orderCount: number;
        orderIds: Set<number>;
      }>();

      // 2. PRICE VARIANCE ANALYSIS: Track price history per product
      const priceHistoryMap = new Map<number | string, Map<number, number>>(); // productId -> Map<pricePerKg, count>

      // 3. DETAILED SALES BREAKDOWN: All order items
      const detailedSalesBreakdown: any[] = [];

      // Process all orders and order items
      orders.forEach((order) => {
        const orderTotal = decimalToNumber(order.total) ?? 0;

        order.orderItems.forEach((item) => {
          const productId = item.productId || `manual-${item.itemName}`;
          const productName = item.itemName;
          const netWeightKg = decimalToNumber(item.netWeightKg) ?? 0;
          const pricePerKg = decimalToNumber(item.pricePerKg) ?? 0;
          const finalTotal = decimalToNumber(item.finalTotal) ?? 0;
          const costPrice = decimalToNumber(item.costPrice);
          const cost = costPrice != null ? costPrice * netWeightKg : null;
          const profit = cost != null ? finalTotal - cost : null;
          const profitMargin = cost != null && finalTotal > 0 ? (profit! / finalTotal) * 100 : null;

          // 1. Aggregate product profit
          if (!productProfitMap.has(productId)) {
            productProfitMap.set(productId, {
              productId: typeof productId === 'number' ? productId : null,
              productName,
              totalQuantitySold: 0,
              totalRevenue: 0,
              totalCost: 0,
              orderCount: 0,
              orderIds: new Set(),
            });
          }
          const productProfit = productProfitMap.get(productId)!;
          productProfit.totalQuantitySold += netWeightKg;
          productProfit.totalRevenue += finalTotal;
          if (cost != null) {
            productProfit.totalCost += cost;
          }
          productProfit.orderIds.add(order.id);

          // 2. Track price history
          if (!priceHistoryMap.has(productId)) {
            priceHistoryMap.set(productId, new Map());
          }
          const priceMap = priceHistoryMap.get(productId)!;
          const priceKey = Math.round(pricePerKg * 100) / 100; // Round to 2 decimals
          priceMap.set(priceKey, (priceMap.get(priceKey) || 0) + 1);

          // 3. Add to detailed sales breakdown
          detailedSalesBreakdown.push({
            orderItemId: item.id,
            date: order.createdAt.toISOString(),
            orderNumber: order.orderNumber,
            itemName: productName,
            productId: typeof productId === 'number' ? productId : null,
            netWeightKg,
            costPrice,
            pricePerKg,
            revenue: finalTotal,
            cost,
            profit,
            profitMargin,
          });
        });
      });

      // Build product profit analysis array
      const productProfitAnalysis = Array.from(productProfitMap.entries()).map(([id, data]) => {
        const totalProfit = data.totalRevenue - data.totalCost;
        const profitMargin = data.totalRevenue > 0 ? (totalProfit / data.totalRevenue) * 100 : 0;

        return {
          productId: data.productId,
          productName: data.productName,
          totalQuantitySold: Number(data.totalQuantitySold.toFixed(3)),
          totalRevenue: Number(data.totalRevenue.toFixed(2)),
          totalCost: Number(data.totalCost.toFixed(2)),
          totalProfit: Number(totalProfit.toFixed(2)),
          profitMargin: Number(profitMargin.toFixed(2)),
          orderCount: data.orderIds.size,
        };
      }).sort((a, b) => b.totalRevenue - a.totalRevenue);

      // Build price variance analysis array
      const priceVarianceAnalysis: any[] = [];

      // Get current product cost prices
      const productIds = Array.from(priceHistoryMap.keys()).filter((id): id is number => typeof id === 'number');
      const products = productIds.length > 0 ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, name: true, costPrice: true },
      }) : [];

      // Get product names for all products (including manual items)
      const productNameMap = new Map<number | string, string>();
      productProfitMap.forEach((data, productId) => {
        productNameMap.set(productId, data.productName);
      });

      priceHistoryMap.forEach((priceMap, productId) => {
        const prices = Array.from(priceMap.keys());
        if (prices.length === 0) return;

        const product = typeof productId === 'number'
          ? products.find(p => p.id === productId)
          : null;

        const productName = productNameMap.get(productId) || product?.name || `Product ${productId}`;

        const priceHistory = Array.from(priceMap.entries()).map(([price, count]) => ({
          pricePerKg: Number(price.toFixed(2)),
          count,
        })).sort((a, b) => a.pricePerKg - b.pricePerKg);

        const totalCount = Array.from(priceMap.values()).reduce((sum, count) => sum + count, 0);
        const weightedSum = prices.reduce((sum, price) => sum + price * priceMap.get(price)!, 0);
        const avgPrice = totalCount > 0 ? weightedSum / totalCount : 0;

        priceVarianceAnalysis.push({
          productId: typeof productId === 'number' ? productId : null,
          productName,
          priceHistory,
          minPrice: Number(Math.min(...prices).toFixed(2)),
          maxPrice: Number(Math.max(...prices).toFixed(2)),
          avgPrice: Number(avgPrice.toFixed(2)),
          currentCostPrice: product ? decimalToNumber(product.costPrice) : null,
        });
      });

      // Sort detailed sales breakdown
      const sortedSalesBreakdown = detailedSalesBreakdown
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      const totalSalesCount = sortedSalesBreakdown.length;
      const limitedSalesBreakdown = sortedSalesBreakdown.slice(0, limitNum);

      return res.json({
        productProfitAnalysis,
        priceVarianceAnalysis,
        detailedSalesBreakdown: limitedSalesBreakdown,
        pagination: {
          limit: limitNum,
          offset: 0,
          total: totalSalesCount,
        },
      });
    } catch (error: any) {
      console.error('Get profit analysis error:', error);
      console.error('Error stack:', error.stack);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    }
  }

  static async getPriceHistory(req: AuthRequest, res: Response) {
    try {
      const { startDate, endDate, changeType, limit } = req.query;

      // Parse dates
      const start = startDate ? new Date(startDate as string) : new Date(0);
      const end = endDate ? new Date(endDate as string) : new Date();
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);

      // Build where clause
      const where: any = {
        createdAt: {
          gte: start,
          lte: end,
        },
      };

      if (changeType && changeType !== 'all') {
        where.changeType = changeType;
      }

      // Get price change history
      const priceChanges = await prisma.priceChangeHistory.findMany({
        where,
        include: {
          product: {
            select: {
              name: true,
              sku: true,
              category: true,
            },
          },
          user: {
            select: {
              fullName: true,
              email: true,
            },
          },
          order: {
            select: {
              orderNumber: true,
            }
          }
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: Math.min(parseLimit(limit, 'orders'), 1000),
      });

      // Transform to match frontend interface
      const records = priceChanges.map((record) => {
        const oldPrice = decimalToNumber(record.oldPrice) ?? 0;
        const newPrice = decimalToNumber(record.newPrice) ?? 0;
        const priceChange = newPrice - oldPrice;
        const percentChange = oldPrice > 0 ? (priceChange / oldPrice) * 100 : 0;

        return {
          id: record.id,
          productId: record.productId,
          userId: record.userId,
          changeType: record.changeType as 'cost_price' | 'selling_price' | 'pos_override',
          oldPrice: Number(oldPrice.toFixed(2)),
          newPrice: Number(newPrice.toFixed(2)),
          notes: record.notes,
          createdAt: record.createdAt.toISOString(),
          productName: record.product?.name || 'Unknown Product',
          sku: record.product?.sku || null,
          category: record.product?.category || null,
          userName: record.user?.fullName || 'Unknown User',
          userEmail: record.user?.email || '',
          priceChange: Number(priceChange.toFixed(2)),
          percentChange: Number(percentChange.toFixed(2)),
          orderNumber: record.order?.orderNumber || null,
        };
      });

      return res.json(records);
    } catch (error: any) {
      console.error('Get price history error:', error);
      console.error('Error stack:', error.stack);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    }
  }

  /**
   * Comprehensive Profit & Loss Statement
   * Shows accurate business performance excluding admin adjustments
   */
  static async getProfitLossStatement(req: AuthRequest, res: Response) {
    try {
      const { startDate, endDate, groupBy = 'total' } = req.query;

      // Parse dates
      const start = startDate ? new Date(startDate as string) : new Date(0);
      const end = endDate ? new Date(endDate as string) : new Date();
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);

      // 1. REVENUE: Get all completed orders (POS sales only - actual revenue)
      const orders = await prisma.order.findMany({
        where: {
          status: 'completed',
          createdAt: {
            gte: start,
            lte: end,
          },
        },
        include: {
          orderItems: true,
        },
      });

      let totalRevenue = 0;
      let totalCOGS = 0;
      let cashSales = 0;
      let cardSales = 0;
      let creditSales = 0; // POS credit orders (not admin adjustments!)

      orders.forEach((order) => {
        const orderTotal = decimalToNumber(order.total) ?? 0;
        totalRevenue += orderTotal;

        // Track by payment method
        if (order.paymentMethod === 'cash') {
          cashSales += orderTotal;
        } else if (order.paymentMethod === 'card') {
          cardSales += orderTotal;
        } else if (order.paymentMethod === 'credit') {
          creditSales += orderTotal; // This is from POS, counts as revenue
        }

        // Calculate COGS from actual batch costs used in this order
        order.orderItems.forEach((item) => {
          const costPrice = decimalToNumber(item.costPrice) ?? 0;
          const quantity = decimalToNumber(item.netWeightKg) ?? 0;
          totalCOGS += costPrice * quantity;
        });
      });

      // 2. OPERATING EXPENSES: Get all expenses in period
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

      let totalExpenses = 0;
      const expensesByCategory = new Map<string, number>();

      expenses.forEach((expense) => {
        const amount = decimalToNumber(expense.amount) ?? 0;
        totalExpenses += amount;

        const categoryName = expense.category?.name || 'Uncategorized';
        expensesByCategory.set(
          categoryName,
          (expensesByCategory.get(categoryName) || 0) + amount
        );
      });

      // 3. CALCULATE PROFIT METRICS
      const grossProfit = totalRevenue - totalCOGS;
      const grossProfitMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

      const netProfit = grossProfit - totalExpenses;
      const netProfitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

      // 4. GET CUSTOMER & SUPPLIER CREDIT INFO (for AR/AP tracking, NOT revenue/COGS)
      // Customer credits - separate POS sales from admin adjustments
      const customerCredits = await prisma.customerCredit.findMany({
        where: {
          createdAt: {
            gte: start,
            lte: end,
          },
        },
      });

      let posCreditSalesInPeriod = 0;
      let adminAdjustmentsInPeriod = 0; // NOT revenue
      let paymentsReceivedInPeriod = 0;

      customerCredits.forEach((credit) => {
        const amount = decimalToNumber(credit.amount) ?? 0;
        if (credit.transactionType === 'credit_added') {
          posCreditSalesInPeriod += amount; // This IS revenue (already counted in orders)
        } else if (credit.transactionType === 'admin_adjustment') {
          adminAdjustmentsInPeriod += amount; // This is NOT revenue (old debt)
        } else if (credit.transactionType === 'credit_used') {
          paymentsReceivedInPeriod += amount; // Cash collection
        }
      });

      // Supplier credits - separate PO purchases from admin credits
      const supplierCredits = await prisma.supplierCredit.findMany({
        where: {
          createdAt: {
            gte: start,
            lte: end,
          },
        },
      });

      let purchasesInPeriod = 0; // Actual PO purchases (counts as COGS)
      let supplierAdminCredits = 0; // NOT COGS (old debt)
      let supplierPaymentsInPeriod = 0;

      supplierCredits.forEach((credit) => {
        const amount = decimalToNumber(credit.amount) ?? 0;
        if (credit.transactionType === 'credit' && credit.purchaseId) {
          purchasesInPeriod += Math.abs(amount); // Actual purchases (already in COGS)
        } else if (credit.transactionType === 'admin_credit') {
          supplierAdminCredits += Math.abs(amount); // NOT COGS (old debt)
        } else if (credit.transactionType === 'debit') {
          supplierPaymentsInPeriod += Math.abs(amount); // Cash paid out
        }
      });

      // 5. CHEQUE TRACKING - Get all cheques in period
      const cheques = await prisma.cheque.findMany({
        where: {
          createdAt: {
            gte: start,
            lte: end,
          },
        },
        include: {
          customer: {
            select: { name: true },
          },
          supplier: {
            select: { name: true },
          },
        },
      });

      let chequesReceived = 0;
      let chequesIssued = 0;
      let chequesPending = 0;
      let chequesCleared = 0;
      let chequesBounced = 0;
      let chequesEndorsed = 0;

      cheques.forEach((cheque) => {
        const amount = decimalToNumber(cheque.amount) ?? 0;

        // Track by transaction type
        if (cheque.transactionType === 'received') {
          chequesReceived += amount;
        } else if (cheque.transactionType === 'issued') {
          chequesIssued += amount;
        }

        // Track by status
        if (cheque.status === 'pending') {
          chequesPending += amount;
        } else if (cheque.status === 'cleared') {
          chequesCleared += amount;
        } else if (cheque.status === 'bounced') {
          chequesBounced += amount;
        }

        // Track endorsements
        if (cheque.isEndorsed) {
          chequesEndorsed += amount;
        }
      });

      // 6. BUILD RESPONSE
      const expenseBreakdown = Array.from(expensesByCategory.entries()).map(([category, amount]) => ({
        category,
        amount: Number(amount.toFixed(2)),
        percentage: totalExpenses > 0 ? Number(((amount / totalExpenses) * 100).toFixed(2)) : 0,
      })).sort((a, b) => b.amount - a.amount);

      return res.json({
        period: {
          startDate: start.toISOString(),
          endDate: end.toISOString(),
        },

        // INCOME STATEMENT
        incomeStatement: {
          // Revenue Section
          revenue: {
            totalRevenue: Number(totalRevenue.toFixed(2)),
            cashSales: Number(cashSales.toFixed(2)),
            cardSales: Number(cardSales.toFixed(2)),
            creditSales: Number(creditSales.toFixed(2)), // POS credit orders
            orderCount: orders.length,
          },

          // Cost of Goods Sold
          costOfGoodsSold: {
            totalCOGS: Number(totalCOGS.toFixed(2)),
            cogsPercentage: totalRevenue > 0 ? Number(((totalCOGS / totalRevenue) * 100).toFixed(2)) : 0,
          },

          // Gross Profit
          grossProfit: {
            amount: Number(grossProfit.toFixed(2)),
            margin: Number(grossProfitMargin.toFixed(2)),
          },

          // Operating Expenses
          operatingExpenses: {
            totalExpenses: Number(totalExpenses.toFixed(2)),
            expensesPercentage: totalRevenue > 0 ? Number(((totalExpenses / totalRevenue) * 100).toFixed(2)) : 0,
            breakdown: expenseBreakdown,
            expenseCount: expenses.length,
          },

          // Net Profit
          netProfit: {
            amount: Number(netProfit.toFixed(2)),
            margin: Number(netProfitMargin.toFixed(2)),
          },
        },

        // ACCOUNTS RECEIVABLE (Customer Credits - for AR tracking only)
        accountsReceivable: {
          posCreditSalesInPeriod: Number(posCreditSalesInPeriod.toFixed(2)), // Already in revenue
          adminAdjustmentsInPeriod: Number(adminAdjustmentsInPeriod.toFixed(2)), // NOT in revenue (old debt)
          paymentsReceivedInPeriod: Number(paymentsReceivedInPeriod.toFixed(2)),
          note: 'POS credit sales are included in revenue. Admin adjustments are old debts and NOT revenue.',
        },

        // ACCOUNTS PAYABLE (Supplier Credits - for AP tracking only)
        accountsPayable: {
          purchasesInPeriod: Number(purchasesInPeriod.toFixed(2)), // Already in COGS
          supplierAdminCreditsInPeriod: Number(supplierAdminCredits.toFixed(2)), // NOT in COGS (old debt)
          supplierPaymentsInPeriod: Number(supplierPaymentsInPeriod.toFixed(2)),
          note: 'Purchases from POs are included in COGS. Admin credits are old debts and NOT COGS.',
        },

        // CHEQUE TRACKING
        chequeTracking: {
          received: {
            total: Number(chequesReceived.toFixed(2)),
            pending: Number(chequesPending.toFixed(2)),
            cleared: Number(chequesCleared.toFixed(2)),
            bounced: Number(chequesBounced.toFixed(2)),
            endorsed: Number(chequesEndorsed.toFixed(2)),
          },
          issued: {
            total: Number(chequesIssued.toFixed(2)),
          },
          count: cheques.length,
          note: 'Cheques received from customers and issued to suppliers. Endorsed cheques are transferred to suppliers as payment.',
        },

        // KEY METRICS SUMMARY
        summary: {
          totalRevenue: Number(totalRevenue.toFixed(2)),
          totalCOGS: Number(totalCOGS.toFixed(2)),
          grossProfit: Number(grossProfit.toFixed(2)),
          grossProfitMargin: Number(grossProfitMargin.toFixed(2)),
          totalExpenses: Number(totalExpenses.toFixed(2)),
          netProfit: Number(netProfit.toFixed(2)),
          netProfitMargin: Number(netProfitMargin.toFixed(2)),
        },
      });
    } catch (error: any) {
      console.error('Get P&L statement error:', error);
      console.error('Error stack:', error.stack);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    }
  }
}
