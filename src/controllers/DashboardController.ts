import { Response } from 'express';
import { prisma } from '../models/db';
import { AuthRequest } from '../middleware/auth';
import { decimalToNumber } from '../utils/decimal';

export class DashboardController {
  static async getStats(req: AuthRequest, res: Response) {
    try {
      const { period = 'today' } = req.query;

      // Calculate date range based on period
      const now = new Date();
      let startDate: Date;

      switch (period) {
        case 'today':
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case 'week':
          startDate = new Date(now);
          startDate.setDate(now.getDate() - 7);
          break;
        case 'month':
          startDate = new Date(now);
          startDate.setMonth(now.getMonth() - 1);
          break;
        case 'all':
        default:
          startDate = new Date(0); // Beginning of time
          break;
      }

      // Get orders in the period
      const orders = await prisma.order.findMany({
        where: {
          status: 'completed',
          createdAt: {
            gte: startDate,
          },
        },
        include: {
          orderItems: true,
        },
      });

      // Calculate revenue - convert Decimal types to numbers
      const totalRevenue = orders.reduce((sum, order) => {
        const orderTotal = decimalToNumber(order.total) ?? 0;
        return sum + orderTotal;
      }, 0);
      const cashRevenue = orders
        .filter((o) => o.paymentMethod === 'cash')
        .reduce((sum, order) => {
          const orderTotal = decimalToNumber(order.total) ?? 0;
          return sum + orderTotal;
        }, 0);
      const cardRevenue = orders
        .filter((o) => o.paymentMethod === 'card')
        .reduce((sum, order) => {
          const orderTotal = decimalToNumber(order.total) ?? 0;
          return sum + orderTotal;
        }, 0);

      // Calculate average order value
      const averageOrderValue = orders.length > 0 ? totalRevenue / orders.length : 0;

      // Get top products
      const productMap = new Map<number, { name: string; quantity: number; revenue: number; orderCount: number }>();
      
      orders.forEach((order) => {
        order.orderItems.forEach((item) => {
          const productId = item.productId || 0;
          const existing = productMap.get(productId) || {
            name: item.itemName,
            quantity: 0,
            revenue: 0,
            orderCount: 0,
          };
          const itemWeight = decimalToNumber(item.netWeightKg) ?? 0;
          const itemRevenue = decimalToNumber(item.finalTotal) ?? 0;
          productMap.set(productId, {
            name: item.itemName,
            quantity: existing.quantity + itemWeight,
            revenue: existing.revenue + itemRevenue,
            orderCount: existing.orderCount + 1,
          });
        });
      });

      const topProducts = Array.from(productMap.values())
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10);

      // Get top cashiers
      const cashierMap = new Map<number, { name: string; orderCount: number; revenue: number }>();
      
      orders.forEach((order) => {
        const existing = cashierMap.get(order.cashierId) || {
          name: 'Unknown',
          orderCount: 0,
          revenue: 0,
        };
        const orderTotal = decimalToNumber(order.total) ?? 0;
        cashierMap.set(order.cashierId, {
          name: existing.name,
          orderCount: existing.orderCount + 1,
          revenue: existing.revenue + orderTotal,
        });
      });

      // Get cashier names
      const cashierIds = Array.from(cashierMap.keys());
      const cashiers = await prisma.user.findMany({
        where: { id: { in: cashierIds } },
        select: { id: true, fullName: true },
      });

      const topCashiers = Array.from(cashierMap.entries())
        .map(([id, data]) => {
          const cashier = cashiers.find((c) => c.id === id);
          return {
            cashierId: id,
            cashierName: cashier?.fullName || 'Unknown',
            orderCount: data.orderCount,
            totalRevenue: data.revenue,
          };
        })
        .sort((a, b) => b.totalRevenue - a.totalRevenue)
        .slice(0, 10);

      // Get low stock products - get all products and filter in memory
      const allProducts = await prisma.product.findMany({
        where: {
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          stockQuantity: true,
          reorderLevel: true,
          category: true,
        },
      });

      const lowStockProducts = allProducts
        .filter((p) => {
          const stockQty = decimalToNumber(p.stockQuantity);
          const reorderLvl = decimalToNumber(p.reorderLevel);
          return stockQty !== null && reorderLvl !== null && stockQty <= reorderLvl;
        })
        .sort((a, b) => {
          const stockA = decimalToNumber(a.stockQuantity) ?? 0;
          const stockB = decimalToNumber(b.stockQuantity) ?? 0;
          return stockA - stockB;
        })
        .slice(0, 10)
        .map(p => ({
          ...p,
          stockQuantity: decimalToNumber(p.stockQuantity),
          reorderLevel: decimalToNumber(p.reorderLevel),
        }));

      // Get customer stats
      const totalCustomers = await prisma.customer.count();
      const newCustomersCount = await prisma.customer.count({
        where: {
          createdAt: {
            gte: startDate,
          },
        },
      });

      // Calculate ACTUAL profit using cost prices from order items
      const actualCOGS = orders.reduce((sum, order) => {
        return sum + order.orderItems.reduce((itemSum, item) => {
          const costPrice = decimalToNumber(item.costPrice) ?? 0;
          const quantity = decimalToNumber(item.netWeightKg) ?? 0;
          return itemSum + (costPrice * quantity);
        }, 0);
      }, 0);

      const actualProfit = totalRevenue - actualCOGS;
      const profitMargin = totalRevenue > 0 ? (actualProfit / totalRevenue) * 100 : 0;
      
      return res.json({
        period: period as string,
        revenue: {
          total: Number(totalRevenue),
          cash: Number(cashRevenue),
          card: Number(cardRevenue),
          orderCount: orders.length,
          averageOrderValue: Number(averageOrderValue),
        },
        topProducts: topProducts.map(p => ({
          ...p,
          quantity: Number(p.quantity),
          revenue: Number(p.revenue),
        })),
        topCashiers: topCashiers.map(c => ({
          ...c,
          totalRevenue: Number(c.totalRevenue),
        })),
        lowStockAlerts: lowStockProducts,
        customerStats: {
          totalCustomers,
          newCustomersThisPeriod: newCustomersCount,
          topCustomer: null, // Would need additional query
        },
        profitAnalysis: {
          totalRevenue: Number(totalRevenue),
          totalCOGS: Number(actualCOGS),
          grossProfit: Number(actualProfit),
          profitMargin: Number(profitMargin),
        },
      });
    } catch (error) {
      console.error('Get dashboard stats error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }
}

