import { Response } from 'express';
import { prisma } from '../models/db';
import { AuthRequest } from '../middleware/auth';
import { decimalToNumber } from '../utils/decimal';
import { getBatchesForProduct, getTotalBatchQuantity } from '../services/batchService';
import { parseLimit, getPaginationParams } from '../config/pagination';

export class BatchController {
  /**
   * Get available batches for a product (for POS batch selection)
   */
  static async getProductBatches(req: AuthRequest, res: Response) {
    try {
      const { productId } = req.params;

      if (!productId) {
        return res.status(400).json({
          error: 'Product ID is required',
          code: 'MISSING_PRODUCT_ID',
        });
      }

      const batches = await getBatchesForProduct(parseInt(productId));

      return res.json({
        productId: parseInt(productId),
        batches,
        totalQuantity: batches.reduce((sum, b) => sum + (b.quantityRemaining || 0), 0),
      });
    } catch (error: any) {
      console.error('Get product batches error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    }
  }

  /**
   * Get all stock batches with filters (for admin reporting)
   */
  static async getAllBatches(req: AuthRequest, res: Response) {
    try {
      const { productId, supplierId, status = 'active', limit, offset = 0 } = req.query;

      const where: any = {};

      if (productId) {
        where.productId = parseInt(productId as string);
      }

      if (supplierId) {
        where.supplierId = parseInt(supplierId as string);
      }

      if (status === 'active') {
        where.quantityRemaining = { gt: 0 };
      } else if (status === 'depleted') {
        where.quantityRemaining = { lte: 0 };
      }

      const batches = await prisma.stockBatch.findMany({
        where,
        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
            },
          },
          supplier: {
            select: {
              id: true,
              name: true,
            },
          },
          purchase: {
            select: {
              purchaseNumber: true,
            },
          },
        },
        orderBy: {
          receivedDate: 'desc',
        },
        take: parseLimit(limit, 'batches'),
        skip: parseInt(offset as string),
      });

      const serialized = batches.map((batch) => ({
        id: batch.id,
        batchNumber: batch.batchNumber,
        productId: batch.productId,
        productName: batch.product?.name || null,
        productSku: batch.product?.sku || null,
        supplierId: batch.supplierId,
        supplierName: batch.supplier?.name || null,
        purchaseNumber: batch.purchase?.purchaseNumber || null,
        receivedDate: batch.receivedDate.toISOString(),
        quantityReceived: decimalToNumber(batch.quantityReceived),
        quantityRemaining: decimalToNumber(batch.quantityRemaining),
        costPrice: decimalToNumber(batch.costPrice),
        expiryDate: batch.expiryDate ? batch.expiryDate.toISOString() : null,
        notes: batch.notes,
        createdAt: batch.createdAt.toISOString(),
      }));

      return res.json(serialized);
    } catch (error: any) {
      console.error('Get all batches error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    }
  }

  /**
   * Get batch details by ID
   */
  static async getBatchById(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          error: 'Batch ID is required',
          code: 'MISSING_BATCH_ID',
        });
      }

      const batch = await prisma.stockBatch.findUnique({
        where: { id: parseInt(id) },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
            },
          },
          supplier: {
            select: {
              id: true,
              name: true,
            },
          },
          purchase: {
            select: {
              purchaseNumber: true,
              status: true,
            },
          },
          orderItemBatches: {
            include: {
              orderItem: {
                include: {
                  order: {
                    select: {
                      orderNumber: true,
                      createdAt: true,
                    },
                  },
                },
              },
            },
            orderBy: {
              createdAt: 'desc',
            },
          },
        },
      });

      if (!batch) {
        return res.status(404).json({
          error: 'Batch not found',
          code: 'BATCH_NOT_FOUND',
        });
      }

      const serialized = {
        id: batch.id,
        batchNumber: batch.batchNumber,
        productId: batch.productId,
        productName: batch.product?.name || null,
        productSku: batch.product?.sku || null,
        supplierId: batch.supplierId,
        supplierName: batch.supplier?.name || null,
        purchaseNumber: batch.purchase?.purchaseNumber || null,
        receivedDate: batch.receivedDate.toISOString(),
        quantityReceived: decimalToNumber(batch.quantityReceived),
        quantityRemaining: decimalToNumber(batch.quantityRemaining),
        quantitySold: decimalToNumber(batch.quantityReceived)! - decimalToNumber(batch.quantityRemaining)!,
        costPrice: decimalToNumber(batch.costPrice),
        expiryDate: batch.expiryDate ? batch.expiryDate.toISOString() : null,
        notes: batch.notes,
        createdAt: batch.createdAt.toISOString(),
        updatedAt: batch.updatedAt.toISOString(),
        usageHistory: batch.orderItemBatches.map((oib) => ({
          orderNumber: oib.orderItem.order.orderNumber,
          orderDate: oib.orderItem.order.createdAt.toISOString(),
          quantityUsed: decimalToNumber(oib.quantityUsed),
          costPrice: decimalToNumber(oib.costPrice),
        })),
      };

      return res.json(serialized);
    } catch (error: any) {
      console.error('Get batch by ID error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    }
  }

  /**
   * Get batch profitability report (Admin)
   * Shows which batches generated how much profit
   */
  static async getBatchProfitReport(req: AuthRequest, res: Response) {
    try {
      const { startDate, endDate, productId, limit } = req.query;

      // Parse dates
      const start = startDate ? new Date(startDate as string) : new Date(0);
      const end = endDate ? new Date(endDate as string) : new Date();
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);

      const where: any = {
        createdAt: {
          gte: start,
          lte: end,
        },
      };

      if (productId) {
        where.orderItem = {
          productId: parseInt(productId as string),
        };
      }

      // Get all order item batches (sales from batches)
      const orderItemBatches = await prisma.orderItemBatch.findMany({
        where,
        include: {
          stockBatch: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  sku: true,
                },
              },
              supplier: {
                select: {
                  name: true,
                },
              },
            },
          },
          orderItem: {
            include: {
              order: {
                select: {
                  orderNumber: true,
                  createdAt: true,
                  total: true,
                },
              },
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: parseLimit(limit, 'batches'),
      });

      // Group by batch to calculate total profit per batch
      const batchProfitMap = new Map<number, {
        batchId: number;
        batchNumber: string;
        productId: number;
        productName: string;
        productSku: string | null;
        supplierName: string | null;
        receivedDate: Date;
        batchCostPrice: number;
        totalQuantitySold: number;
        totalCost: number;
        totalRevenue: number;
        totalProfit: number;
        orderCount: number;
        orders: Set<string>;
      }>();

      orderItemBatches.forEach((oib) => {
        const batchId = oib.stockBatchId;
        const quantitySold = decimalToNumber(oib.quantityUsed) || 0;
        const costPrice = decimalToNumber(oib.costPrice) || 0;
        const cost = quantitySold * costPrice;

        // Calculate revenue for this portion
        const orderItem = oib.orderItem;
        const itemTotal = decimalToNumber(orderItem.finalTotal) || 0;
        const itemNetWeight = decimalToNumber(orderItem.netWeightKg) || 1;
        const pricePerKg = itemNetWeight > 0 ? itemTotal / itemNetWeight : 0;
        const revenue = quantitySold * pricePerKg;
        const profit = revenue - cost;

        if (!batchProfitMap.has(batchId)) {
          batchProfitMap.set(batchId, {
            batchId,
            batchNumber: oib.stockBatch.batchNumber,
            productId: oib.stockBatch.productId,
            productName: oib.stockBatch.product?.name || 'Unknown',
            productSku: oib.stockBatch.product?.sku || null,
            supplierName: oib.stockBatch.supplier?.name || null,
            receivedDate: oib.stockBatch.receivedDate,
            batchCostPrice: decimalToNumber(oib.stockBatch.costPrice) || 0,
            totalQuantitySold: 0,
            totalCost: 0,
            totalRevenue: 0,
            totalProfit: 0,
            orderCount: 0,
            orders: new Set(),
          });
        }

        const batchData = batchProfitMap.get(batchId)!;
        batchData.totalQuantitySold += quantitySold;
        batchData.totalCost += cost;
        batchData.totalRevenue += revenue;
        batchData.totalProfit += profit;
        batchData.orders.add(orderItem.order.orderNumber);
      });

      // Convert to array and calculate metrics
      const batchProfitReport = Array.from(batchProfitMap.values()).map((batch) => ({
        batchId: batch.batchId,
        batchNumber: batch.batchNumber,
        productId: batch.productId,
        productName: batch.productName,
        productSku: batch.productSku,
        supplierName: batch.supplierName,
        receivedDate: batch.receivedDate.toISOString(),
        batchCostPrice: Number(batch.batchCostPrice.toFixed(2)),
        totalQuantitySold: Number(batch.totalQuantitySold.toFixed(3)),
        totalCost: Number(batch.totalCost.toFixed(2)),
        totalRevenue: Number(batch.totalRevenue.toFixed(2)),
        totalProfit: Number(batch.totalProfit.toFixed(2)),
        profitMargin: batch.totalRevenue > 0
          ? Number(((batch.totalProfit / batch.totalRevenue) * 100).toFixed(2))
          : 0,
        orderCount: batch.orders.size,
      })).sort((a, b) => b.totalProfit - a.totalProfit); // Sort by most profitable first

      // Calculate summary
      const summary = {
        totalBatches: batchProfitReport.length,
        totalQuantitySold: batchProfitReport.reduce((sum, b) => sum + b.totalQuantitySold, 0),
        totalCost: batchProfitReport.reduce((sum, b) => sum + b.totalCost, 0),
        totalRevenue: batchProfitReport.reduce((sum, b) => sum + b.totalRevenue, 0),
        totalProfit: batchProfitReport.reduce((sum, b) => sum + b.totalProfit, 0),
        avgProfitMargin: 0,
      };

      summary.avgProfitMargin = summary.totalRevenue > 0
        ? Number(((summary.totalProfit / summary.totalRevenue) * 100).toFixed(2))
        : 0;

      return res.json({
        summary: {
          totalBatches: summary.totalBatches,
          totalQuantitySold: Number(summary.totalQuantitySold.toFixed(3)),
          totalCost: Number(summary.totalCost.toFixed(2)),
          totalRevenue: Number(summary.totalRevenue.toFixed(2)),
          totalProfit: Number(summary.totalProfit.toFixed(2)),
          avgProfitMargin: summary.avgProfitMargin,
        },
        batches: batchProfitReport,
      });
    } catch (error: any) {
      console.error('Get batch profit report error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    }
  }

  /**
   * Get detailed batch usage in orders (Admin)
   * Shows which orders used which batches
   */
  static async getBatchUsageInOrders(req: AuthRequest, res: Response) {
    try {
      const { batchId, startDate, endDate, limit } = req.query;

      if (!batchId) {
        return res.status(400).json({
          error: 'Batch ID is required',
          code: 'MISSING_BATCH_ID',
        });
      }

      // Parse dates
      const start = startDate ? new Date(startDate as string) : new Date(0);
      const end = endDate ? new Date(endDate as string) : new Date();
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);

      const usage = await prisma.orderItemBatch.findMany({
        where: {
          stockBatchId: parseInt(batchId as string),
          createdAt: {
            gte: start,
            lte: end,
          },
        },
        include: {
          orderItem: {
            include: {
              order: {
                select: {
                  id: true,
                  orderNumber: true,
                  createdAt: true,
                  total: true,
                  cashier: {
                    select: {
                      fullName: true,
                    },
                  },
                  customer: {
                    select: {
                      name: true,
                    },
                  },
                },
              },
              product: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: parseLimit(limit, 'batches'),
      });

      const usageDetails = usage.map((u) => {
        const quantityUsed = decimalToNumber(u.quantityUsed) || 0;
        const costPrice = decimalToNumber(u.costPrice) || 0;
        const cost = quantityUsed * costPrice;

        const orderItem = u.orderItem;
        const itemTotal = decimalToNumber(orderItem.finalTotal) || 0;
        const itemNetWeight = decimalToNumber(orderItem.netWeightKg) || 1;
        const pricePerKg = itemNetWeight > 0 ? itemTotal / itemNetWeight : 0;
        const revenue = quantityUsed * pricePerKg;
        const profit = revenue - cost;
        const profitMargin = revenue > 0 ? (profit / revenue) * 100 : 0;

        return {
          orderNumber: orderItem.order.orderNumber,
          orderDate: orderItem.order.createdAt.toISOString(),
          cashierName: orderItem.order.cashier?.fullName || 'Unknown',
          customerName: orderItem.order.customer?.name || 'Walk-in',
          productName: orderItem.product?.name || orderItem.itemName,
          quantityUsed: Number(quantityUsed.toFixed(3)),
          costPrice: Number(costPrice.toFixed(2)),
          sellingPricePerKg: Number(pricePerKg.toFixed(2)),
          cost: Number(cost.toFixed(2)),
          revenue: Number(revenue.toFixed(2)),
          profit: Number(profit.toFixed(2)),
          profitMargin: Number(profitMargin.toFixed(2)),
        };
      });

      // Get batch info
      const batch = await prisma.stockBatch.findUnique({
        where: { id: parseInt(batchId as string) },
        include: {
          product: {
            select: {
              name: true,
              sku: true,
            },
          },
          supplier: {
            select: {
              name: true,
            },
          },
        },
      });

      const summary = {
        totalOrders: usageDetails.length,
        totalQuantityUsed: usageDetails.reduce((sum, u) => sum + u.quantityUsed, 0),
        totalCost: usageDetails.reduce((sum, u) => sum + u.cost, 0),
        totalRevenue: usageDetails.reduce((sum, u) => sum + u.revenue, 0),
        totalProfit: usageDetails.reduce((sum, u) => sum + u.profit, 0),
        avgProfitMargin: 0,
      };

      summary.avgProfitMargin = summary.totalRevenue > 0
        ? Number(((summary.totalProfit / summary.totalRevenue) * 100).toFixed(2))
        : 0;

      return res.json({
        batch: batch ? {
          batchNumber: batch.batchNumber,
          productName: batch.product?.name || 'Unknown',
          productSku: batch.product?.sku || null,
          supplierName: batch.supplier?.name || null,
          receivedDate: batch.receivedDate.toISOString(),
          quantityReceived: decimalToNumber(batch.quantityReceived),
          quantityRemaining: decimalToNumber(batch.quantityRemaining),
          costPrice: decimalToNumber(batch.costPrice),
        } : null,
        summary: {
          totalOrders: summary.totalOrders,
          totalQuantityUsed: Number(summary.totalQuantityUsed.toFixed(3)),
          totalCost: Number(summary.totalCost.toFixed(2)),
          totalRevenue: Number(summary.totalRevenue.toFixed(2)),
          totalProfit: Number(summary.totalProfit.toFixed(2)),
          avgProfitMargin: summary.avgProfitMargin,
        },
        usage: usageDetails,
      });
    } catch (error: any) {
      console.error('Get batch usage in orders error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    }
  }

  /**
   * Get order batch breakdown (Admin)
   * Shows all batches used in a specific order
   */
  static async getOrderBatchBreakdown(req: AuthRequest, res: Response) {
    try {
      const { orderId } = req.params;

      if (!orderId) {
        return res.status(400).json({
          error: 'Order ID is required',
          code: 'MISSING_ORDER_ID',
        });
      }

      // Get order details
      const order = await prisma.order.findUnique({
        where: { id: parseInt(orderId) },
        select: {
          id: true,
          orderNumber: true,
          createdAt: true,
          subtotal: true,
          discountAmount: true,
          total: true,
          cashier: {
            select: {
              fullName: true,
            },
          },
          customer: {
            select: {
              name: true,
            },
          },
        },
      });

      if (!order) {
        return res.status(404).json({
          error: 'Order not found',
          code: 'ORDER_NOT_FOUND',
        });
      }

      // Get all order items with batch allocations
      const orderItems = await prisma.orderItem.findMany({
        where: { orderId: parseInt(orderId) },
        include: {
          product: {
            select: {
              name: true,
              sku: true,
            },
          },
          orderItemBatches: {
            include: {
              stockBatch: {
                select: {
                  batchNumber: true,
                  receivedDate: true,
                  costPrice: true,
                  supplier: {
                    select: {
                      name: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      const itemsWithBatches = orderItems.map((item) => {
        const netWeight = decimalToNumber(item.netWeightKg) || 0;
        const pricePerKg = decimalToNumber(item.pricePerKg) || 0;
        const finalTotal = decimalToNumber(item.finalTotal) || 0;
        const itemCostPrice = decimalToNumber(item.costPrice) || 0;

        const batches = item.orderItemBatches.map((oib) => {
          const quantityUsed = decimalToNumber(oib.quantityUsed) || 0;
          const batchCostPrice = decimalToNumber(oib.costPrice) || 0;
          const batchCost = quantityUsed * batchCostPrice;
          const batchRevenue = quantityUsed * pricePerKg;
          const batchProfit = batchRevenue - batchCost;

          return {
            batchNumber: oib.batchNumber,
            batchReceivedDate: oib.stockBatch.receivedDate.toISOString(),
            supplierName: oib.stockBatch.supplier?.name || null,
            quantityUsed: Number(quantityUsed.toFixed(3)),
            batchCostPrice: Number(batchCostPrice.toFixed(2)),
            batchCost: Number(batchCost.toFixed(2)),
            batchRevenue: Number(batchRevenue.toFixed(2)),
            batchProfit: Number(batchProfit.toFixed(2)),
          };
        });

        const totalItemCost = batches.reduce((sum, b) => sum + b.batchCost, 0);
        const totalItemProfit = finalTotal - totalItemCost;
        const itemProfitMargin = finalTotal > 0 ? (totalItemProfit / finalTotal) * 100 : 0;

        return {
          productId: item.productId,
          productName: item.product?.name || item.itemName,
          productSku: item.product?.sku || null,
          netWeightKg: Number(netWeight.toFixed(3)),
          pricePerKg: Number(pricePerKg.toFixed(2)),
          finalTotal: Number(finalTotal.toFixed(2)),
          averageCostPrice: Number(itemCostPrice.toFixed(2)),
          totalCost: Number(totalItemCost.toFixed(2)),
          totalProfit: Number(totalItemProfit.toFixed(2)),
          profitMargin: Number(itemProfitMargin.toFixed(2)),
          batchCount: batches.length,
          batches,
        };
      });

      const summary = {
        orderTotal: decimalToNumber(order.total) || 0,
        totalCost: itemsWithBatches.reduce((sum, item) => sum + item.totalCost, 0),
        totalProfit: itemsWithBatches.reduce((sum, item) => sum + item.totalProfit, 0),
        totalBatchesUsed: itemsWithBatches.reduce((sum, item) => sum + item.batchCount, 0),
      };

      summary.totalProfit = summary.orderTotal - summary.totalCost;
      const profitMargin = summary.orderTotal > 0
        ? (summary.totalProfit / summary.orderTotal) * 100
        : 0;

      return res.json({
        order: {
          orderNumber: order.orderNumber,
          orderDate: order.createdAt.toISOString(),
          cashierName: order.cashier?.fullName || 'Unknown',
          customerName: order.customer?.name || 'Walk-in',
          orderTotal: Number((decimalToNumber(order.total) || 0).toFixed(2)),
        },
        summary: {
          orderTotal: Number(summary.orderTotal.toFixed(2)),
          totalCost: Number(summary.totalCost.toFixed(2)),
          totalProfit: Number(summary.totalProfit.toFixed(2)),
          profitMargin: Number(profitMargin.toFixed(2)),
          totalBatchesUsed: summary.totalBatchesUsed,
          itemCount: itemsWithBatches.length,
        },
        items: itemsWithBatches,
      });
    } catch (error: any) {
      console.error('Get order batch breakdown error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    }
  }

  /**
   * Get batch cost analysis for a product
   */
  static async getBatchCostAnalysis(req: AuthRequest, res: Response) {
    try {
      const { productId } = req.params;

      if (!productId) {
        return res.status(400).json({
          error: 'Product ID is required',
          code: 'MISSING_PRODUCT_ID',
        });
      }

      const batches = await prisma.stockBatch.findMany({
        where: {
          productId: parseInt(productId),
        },
        orderBy: {
          receivedDate: 'asc',
        },
      });

      if (batches.length === 0) {
        return res.json({
          productId: parseInt(productId),
          totalBatches: 0,
          activeBatches: 0,
          totalReceived: 0,
          totalRemaining: 0,
          totalSold: 0,
          minCostPrice: null,
          maxCostPrice: null,
          avgCostPrice: null,
          currentAvgCostPrice: null,
          batches: [],
        });
      }

      const totalReceived = batches.reduce((sum, b) => sum + decimalToNumber(b.quantityReceived)!, 0);
      const totalRemaining = batches.reduce((sum, b) => sum + decimalToNumber(b.quantityRemaining)!, 0);
      const totalSold = totalReceived - totalRemaining;

      const activeBatches = batches.filter((b) => decimalToNumber(b.quantityRemaining)! > 0);

      // Calculate average cost of all received inventory
      const totalCost = batches.reduce(
        (sum, b) => sum + decimalToNumber(b.quantityReceived)! * decimalToNumber(b.costPrice)!,
        0
      );
      const avgCostPrice = totalReceived > 0 ? totalCost / totalReceived : 0;

      // Calculate current average cost (only active batches)
      const currentTotalCost = activeBatches.reduce(
        (sum, b) => sum + decimalToNumber(b.quantityRemaining)! * decimalToNumber(b.costPrice)!,
        0
      );
      const currentAvgCostPrice = totalRemaining > 0 ? currentTotalCost / totalRemaining : 0;

      const costPrices = batches.map((b) => decimalToNumber(b.costPrice)!);
      const minCostPrice = Math.min(...costPrices);
      const maxCostPrice = Math.max(...costPrices);

      return res.json({
        productId: parseInt(productId),
        totalBatches: batches.length,
        activeBatches: activeBatches.length,
        totalReceived: Number(totalReceived.toFixed(3)),
        totalRemaining: Number(totalRemaining.toFixed(3)),
        totalSold: Number(totalSold.toFixed(3)),
        minCostPrice: Number(minCostPrice.toFixed(2)),
        maxCostPrice: Number(maxCostPrice.toFixed(2)),
        avgCostPrice: Number(avgCostPrice.toFixed(2)),
        currentAvgCostPrice: Number(currentAvgCostPrice.toFixed(2)),
        batches: batches.map((b) => ({
          batchNumber: b.batchNumber,
          receivedDate: b.receivedDate.toISOString(),
          quantityReceived: decimalToNumber(b.quantityReceived),
          quantityRemaining: decimalToNumber(b.quantityRemaining),
          costPrice: decimalToNumber(b.costPrice),
          status: decimalToNumber(b.quantityRemaining)! > 0 ? 'active' : 'depleted',
        })),
      });
    } catch (error: any) {
      console.error('Get batch cost analysis error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    }
  }
}
