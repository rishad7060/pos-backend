import { Request, Response } from 'express';
import { prisma } from '../models/db';
import { AuthRequest } from '../middleware/auth';
import { decimalToNumber, serializeOrder } from '../utils/decimal';
import {
  calculateItemTotals,
  calculateOrderTotals,
  validateItem,
  RawItemInput,
  CalculatedItem
} from '../utils/order-calculations';

export class OrdersController {
  static async getOrders(req: AuthRequest, res: Response) {
    try {
      const {
        id,
        orderNumber,
        cashierId,
        registrySessionId, // TEAM_003: Support filtering by registry session
        status,
        startDate,
        endDate,
        limit = 50,
        offset = 0
      } = req.query;

      // Single order retrieval by ID
      if (id) {
        const orderId = parseInt(id as string);
        if (isNaN(orderId)) {
          return res.status(400).json({
            error: "Valid ID is required",
            code: "INVALID_ID"
          });
        }

        const order = await prisma.order.findUnique({
          where: { id: orderId },
          include: {
            orderItems: true,
            cashier: {
              select: { id: true, fullName: true, email: true }
            },
            customer: {
              select: { id: true, name: true, phone: true, email: true }
            }
          }
        });

        if (!order) {
          return res.status(404).json({
            error: 'Order not found',
            code: 'ORDER_NOT_FOUND'
          });
        }

        // Convert Decimal types to numbers
        const serializedOrder = serializeOrder(order);

        return res.json({
          order: serializedOrder,
          items: serializedOrder.orderItems
        });
      }

      // Single order retrieval by order number
      if (orderNumber) {
        const order = await prisma.order.findUnique({
          where: { orderNumber: orderNumber as string },
          include: {
            orderItems: true,
            cashier: {
              select: { id: true, fullName: true, email: true }
            },
            customer: {
              select: { id: true, name: true, phone: true, email: true }
            }
          }
        });

        if (!order) {
          return res.status(404).json({
            error: 'Order not found',
            code: 'ORDER_NOT_FOUND'
          });
        }

        // Convert Decimal types to numbers
        const serializedOrder = serializeOrder(order);

        return res.json({
          order: serializedOrder,
          items: serializedOrder.orderItems
        });
      }

      // Build where conditions
      const where: any = {};

      if (cashierId) {
        where.cashierId = parseInt(cashierId as string);
      }

      // TEAM_003: Filter by registry session
      if (registrySessionId) {
        where.registrySessionId = parseInt(registrySessionId as string);
      }

      if (status) {
        if (status !== 'completed' && status !== 'voided') {
          return res.status(400).json({
            error: "Status must be 'completed' or 'voided'",
            code: "INVALID_STATUS"
          });
        }
        where.status = status;
      }

      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) where.createdAt.gte = new Date(startDate as string);
        if (endDate) where.createdAt.lte = new Date(endDate as string);
      }

      // If cashier role, only show their orders
      if (req.user?.role === 'cashier') {
        where.cashierId = req.user.id;
      }

      const orders = await prisma.order.findMany({
        where,
        include: {
          orderItems: true,
          cashier: {
            select: { id: true, fullName: true, email: true }
          },
          customer: {
            select: { id: true, name: true, phone: true, email: true }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: Math.min(parseInt(limit as string), 100),
        skip: parseInt(offset as string)
      });

      // Convert all Decimal types to numbers for all orders
      const serializedOrders = orders.map(serializeOrder);

      return res.json(serializedOrders);
    } catch (error) {
      console.error('Get orders error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR'
      });
    }
  }

  static async createOrder(req: AuthRequest, res: Response) {
    try {
      const {
        cashierId,
        customerId,
        registrySessionId, // TEAM_003: Link order to registry session
        items,
        discountPercent = 0,
        paymentMethod,
        cashReceived,
        changeGiven,
        payments,
        notes,
      } = req.body;

      // Validate required fields
      if (!cashierId) {
        return res.status(400).json({
          error: 'Cashier ID is required',
          code: 'MISSING_CASHIER_ID',
        });
      }

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          error: 'Order must have at least one item',
          code: 'NO_ITEMS',
        });
      }

      if (!paymentMethod) {
        return res.status(400).json({
          error: 'Payment method is required',
          code: 'MISSING_PAYMENT_METHOD',
        });
      }

      // Use transaction to ensure atomicity
      const result = await prisma.$transaction(async (tx) => {
        // Generate unique order number (format: ORD-YYYYMMDD-HHMMSS-XXXX)
        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
        const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '');
        const randomSuffix = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        let orderNumber = `ORD-${dateStr}-${randomSuffix}`;

        // Ensure order number is unique
        let orderExists = await tx.order.findUnique({ where: { orderNumber } });
        let attempts = 0;
        while (orderExists && attempts < 10) {
          const newSuffix = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
          orderNumber = `ORD-${dateStr}-${newSuffix}`;
          orderExists = await tx.order.findUnique({ where: { orderNumber } });
          attempts++;
        }

        if (orderExists) {
          throw new Error('Failed to generate unique order number');
        }

        // IMPORTANT: All calculations are done on the backend for security and accuracy
        // Frontend sends only raw input data - we ignore any calculated values

        // Validate and calculate all item totals from raw inputs
        const calculatedItems: CalculatedItem[] = [];

        for (const rawItem of items) {
          // Validate item input
          const validation = validateItem({
            productId: rawItem.productId || null,
            itemName: rawItem.itemName || 'Unknown Item',
            quantityType: rawItem.quantityType || 'kg',
            itemWeightKg: parseFloat(rawItem.itemWeightKg) || 0,
            itemWeightG: parseFloat(rawItem.itemWeightG) || 0,
            boxWeightKg: rawItem.boxWeightKg ? parseFloat(rawItem.boxWeightKg) : undefined,
            boxWeightG: rawItem.boxWeightG ? parseFloat(rawItem.boxWeightG) : undefined,
            boxCount: rawItem.boxCount ? parseInt(rawItem.boxCount) : undefined,
            pricePerKg: parseFloat(rawItem.pricePerKg) || 0,
            itemDiscountPercent: parseFloat(rawItem.itemDiscountPercent) || 0,
          });

          if (!validation.valid) {
            throw new Error(`Invalid item: ${validation.error}`);
          }

          // Calculate all item totals on backend
          const calculatedItem = calculateItemTotals({
            productId: rawItem.productId || null,
            itemName: rawItem.itemName || 'Unknown Item',
            quantityType: rawItem.quantityType || 'kg',
            itemWeightKg: parseFloat(rawItem.itemWeightKg) || 0,
            itemWeightG: parseFloat(rawItem.itemWeightG) || 0,
            boxWeightKg: rawItem.boxWeightKg ? parseFloat(rawItem.boxWeightKg) : undefined,
            boxWeightG: rawItem.boxWeightG ? parseFloat(rawItem.boxWeightG) : undefined,
            boxCount: rawItem.boxCount ? parseInt(rawItem.boxCount) : undefined,
            pricePerKg: parseFloat(rawItem.pricePerKg) || 0,
            itemDiscountPercent: parseFloat(rawItem.itemDiscountPercent) || 0,
          });

          calculatedItems.push(calculatedItem);
        }

        // Calculate order totals from calculated items
        // Get tax rate from business settings (default to 0 for now)
        const taxPercent = 0; // TODO: Fetch from BusinessSetting
        const orderTotals = calculateOrderTotals(calculatedItems, discountPercent, taxPercent);

        // Create the order with backend-calculated totals
        const order = await tx.order.create({
          data: {
            orderNumber,
            cashierId: parseInt(cashierId),
            customerId: customerId ? parseInt(customerId) : null,
            registrySessionId: registrySessionId ? parseInt(registrySessionId) : null, // TEAM_003: Link to registry session
            subtotal: orderTotals.subtotal,
            discountAmount: orderTotals.discountAmount,
            discountPercent: orderTotals.discountPercent,
            taxAmount: orderTotals.taxAmount,
            total: orderTotals.total,
            paymentMethod: paymentMethod,
            cashReceived: cashReceived ? parseFloat(cashReceived) : null,
            changeGiven: changeGiven ? parseFloat(changeGiven) : null,
            notes: notes || null,
            status: 'completed',
          },
        });

        // Fetch product cost prices for order items
        const productIds = calculatedItems
          .map((item) => item.productId)
          .filter((id): id is number => id != null);

        const products = productIds.length > 0
          ? await tx.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, costPrice: true, defaultPricePerKg: true, name: true },
          })
          : [];

        const productMap = new Map(
          products.map((p) => [p.id, p])
        );

        // Create order items and update stock using backend-calculated values
        const createdOrderItems = [];
        const stockUpdates: Array<{ productId: number; quantityChange: number; quantityAfter: number }> = [];

        for (const calculatedItem of calculatedItems) {
          // Get product details
          const product = calculatedItem.productId ? productMap.get(calculatedItem.productId) : null;

          // Get cost price from product
          let costPrice: number | null = null;
          if (product && product.costPrice != null) {
            const productCost = product.costPrice;
            costPrice = typeof productCost === 'object' && 'toNumber' in productCost
              ? productCost.toNumber()
              : typeof productCost === 'string'
                ? parseFloat(productCost)
                : typeof productCost === 'number'
                  ? productCost
                  : null;
          }

          const orderItem = await tx.orderItem.create({
            data: {
              productId: calculatedItem.productId,
              itemName: calculatedItem.itemName,
              quantityType: calculatedItem.quantityType,
              itemWeightKg: calculatedItem.itemWeightKg,
              itemWeightG: calculatedItem.itemWeightG,
              itemWeightTotalKg: calculatedItem.itemWeightTotalKg,
              boxWeightKg: calculatedItem.boxWeightKg,
              boxWeightG: calculatedItem.boxWeightG,
              boxWeightPerBoxKg: calculatedItem.boxWeightPerBoxKg,
              boxCount: calculatedItem.boxCount,
              totalBoxWeightKg: calculatedItem.totalBoxWeightKg,
              netWeightKg: calculatedItem.netWeightKg,
              pricePerKg: calculatedItem.pricePerKg,
              baseTotal: calculatedItem.baseTotal,
              itemDiscountPercent: calculatedItem.itemDiscountPercent,
              itemDiscountAmount: calculatedItem.itemDiscountAmount,
              finalTotal: calculatedItem.finalTotal,
              costPrice: costPrice,
              orderId: order.id,
            },
          });

          // Check for Price Override (POS Edit)
          if (product && product.defaultPricePerKg != null) {
            const defaultPrice = typeof product.defaultPricePerKg === 'object' && 'toNumber' in product.defaultPricePerKg
              ? product.defaultPricePerKg.toNumber()
              : Number(product.defaultPricePerKg);

            const soldPrice = calculatedItem.pricePerKg;

            // Log if price differs significantly (> 0.01)
            if (Math.abs(defaultPrice - soldPrice) > 0.01) {
              await tx.priceChangeHistory.create({
                data: {
                  productId: product.id,
                  userId: parseInt(cashierId),
                  orderId: order.id,
                  changeType: 'pos_override',
                  oldPrice: defaultPrice,
                  newPrice: soldPrice,
                  notes: 'POS Override during sale'
                }
              });
            }
          }

          createdOrderItems.push(orderItem);

          // Update stock if product exists and has weight-based quantity
          if (calculatedItem.productId && calculatedItem.netWeightKg > 0) {
            // For weight-based products, we need to update stock quantity
            // Assuming stockQuantity is in kg, we'll deduct the netWeightKg
            const product = await tx.product.findUnique({
              where: { id: calculatedItem.productId },
              select: { stockQuantity: true, unitType: true },
            });

            if (product) {
              let quantityToDeduct = 0;
              if (product.unitType === 'weight') {
                // For weight-based, deduct exact net weight in kg
                quantityToDeduct = calculatedItem.netWeightKg; // Use exact weight, not rounded up
              } else {
                // For unit-based, deduct by box count or quantity
                quantityToDeduct = calculatedItem.boxCount || 1;
              }

              const currentStock = decimalToNumber(product.stockQuantity);
              if (currentStock === null) {
                throw new Error(`Product ${calculatedItem.productId} has null stock quantity`);
              }
              const rawDifference = currentStock - quantityToDeduct;

              // Use very high precision to avoid floating point errors
              let newStockQuantity = Number(rawDifference.toFixed(10));

              // Only set to 0 if truly negative (not due to tiny precision errors)
              if (newStockQuantity < -0.0001) { // Allow for tiny negative values due to precision
                newStockQuantity = 0;
              } else if (newStockQuantity < 0) {
                // Tiny negative due to precision, clamp to 0
                newStockQuantity = 0;
              }

              // Round to 3 decimal places for storage
              newStockQuantity = Number(newStockQuantity.toFixed(3));

              console.log(`Final stock after update: ${newStockQuantity}`);

              await tx.product.update({
                where: { id: calculatedItem.productId },
                data: { stockQuantity: newStockQuantity },
              });

              // Create stock movement record
              await tx.stockMovement.create({
                data: {
                  productId: calculatedItem.productId,
                  movementType: 'sale',
                  quantityChange: -quantityToDeduct,
                  quantityAfter: newStockQuantity,
                  orderId: order.id,
                  userId: parseInt(cashierId),
                  notes: `Order ${orderNumber}`,
                },
              });

              stockUpdates.push({
                productId: calculatedItem.productId,
                quantityChange: -quantityToDeduct,
                quantityAfter: newStockQuantity,
              });
            }
          }
        }

        // Create payment details for split payments
        if (payments && Array.isArray(payments) && payments.length > 0) {
          for (const payment of payments) {
            await tx.paymentDetail.create({
              data: {
                orderId: order.id,
                paymentType: payment.type || paymentMethod,
                amount: parseFloat(payment.amount) || 0,
                cardType: payment.cardType || null,
                reference: payment.reference || null,
              },
            });
          }
        } else if (paymentMethod !== 'cash') {
          // Create single payment detail for non-cash payments
          await tx.paymentDetail.create({
            data: {
              orderId: order.id,
              paymentType: paymentMethod,
              amount: orderTotals.total,
              cardType: req.body.cardType || null,
              reference: req.body.reference || null,
            },
          });
        }

        // Update customer stats if customer exists (using backend-calculated total)
        if (customerId) {
          await tx.customer.update({
            where: { id: parseInt(customerId) },
            data: {
              totalPurchases: { increment: orderTotals.total },
              visitCount: { increment: 1 },
            },
          });
        }

        // Calculate credit amount
        let creditAmount = 0;
        if (paymentMethod === 'credit') {
          creditAmount = orderTotals.total;
        } else if (payments && Array.isArray(payments)) {
          creditAmount = payments
            .filter((p: any) => p.type === 'credit')
            .reduce((sum: number, p: any) => sum + (parseFloat(p.amount) || 0), 0);
        }

        // Create customer credit record if applicable
        if (creditAmount > 0 && customerId) {
          const customerIdNum = parseInt(customerId);

          // Calculate running balance
          const existingCredits = await tx.customerCredit.findMany({
            where: { customerId: customerIdNum },
            select: { amount: true },
          });

          let runningBalance = 0;
          for (const credit of existingCredits) {
            runningBalance += decimalToNumber(credit.amount) ?? 0;
          }
          runningBalance += creditAmount;

          await tx.customerCredit.create({
            data: {
              customerId: customerIdNum,
              orderId: order.id,
              transactionType: 'sale',
              amount: creditAmount,
              balance: runningBalance,
              description: `Credit purchase for Order #${orderNumber}`,
              userId: parseInt(cashierId),
            },
          });
        }

        // Fetch the complete order with relations
        const completeOrder = await tx.order.findUnique({
          where: { id: order.id },
          include: {
            orderItems: true,
            paymentDetails: true,
            cashier: {
              select: { id: true, fullName: true, email: true },
            },
            customer: {
              select: { id: true, name: true, phone: true, email: true },
            },
          },
        });

        if (!completeOrder) {
          throw new Error('Failed to retrieve created order');
        }

        return completeOrder;
      });

      // Convert Decimal types to numbers for JSON response
      const serializedOrder = {
        ...result,
        subtotal: typeof result.subtotal === 'object' && 'toNumber' in result.subtotal
          ? result.subtotal.toNumber()
          : typeof result.subtotal === 'string'
            ? parseFloat(result.subtotal)
            : result.subtotal,
        discountAmount: typeof result.discountAmount === 'object' && 'toNumber' in result.discountAmount
          ? result.discountAmount.toNumber()
          : typeof result.discountAmount === 'string'
            ? parseFloat(result.discountAmount)
            : result.discountAmount,
        discountPercent: typeof result.discountPercent === 'object' && 'toNumber' in result.discountPercent
          ? result.discountPercent.toNumber()
          : typeof result.discountPercent === 'string'
            ? parseFloat(result.discountPercent)
            : result.discountPercent,
        taxAmount: typeof result.taxAmount === 'object' && 'toNumber' in result.taxAmount
          ? result.taxAmount.toNumber()
          : typeof result.taxAmount === 'string'
            ? parseFloat(result.taxAmount)
            : result.taxAmount,
        total: typeof result.total === 'object' && 'toNumber' in result.total
          ? result.total.toNumber()
          : typeof result.total === 'string'
            ? parseFloat(result.total)
            : result.total,
        cashReceived: result.cashReceived
          ? (typeof result.cashReceived === 'object' && 'toNumber' in result.cashReceived
            ? result.cashReceived.toNumber()
            : typeof result.cashReceived === 'string'
              ? parseFloat(result.cashReceived)
              : result.cashReceived)
          : null,
        changeGiven: result.changeGiven
          ? (typeof result.changeGiven === 'object' && 'toNumber' in result.changeGiven
            ? result.changeGiven.toNumber()
            : typeof result.changeGiven === 'string'
              ? parseFloat(result.changeGiven)
              : result.changeGiven)
          : null,
        orderItems: result.orderItems.map((item: any) => ({
          ...item,
          itemWeightKg: typeof item.itemWeightKg === 'object' && 'toNumber' in item.itemWeightKg
            ? item.itemWeightKg.toNumber()
            : typeof item.itemWeightKg === 'string'
              ? parseFloat(item.itemWeightKg)
              : item.itemWeightKg,
          // Add more field conversions as needed
        })),
      };

      return res.status(201).json({
        order: serializedOrder,
        message: 'Order created successfully',
      });
    } catch (error: any) {
      console.error('Create order error:', error);
      return res.status(500).json({
        error: error.message || 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  static async getOrderProfitDetails(req: AuthRequest, res: Response) {
    try {
      const { startDate, endDate, profitStatus = 'all', limit = 100 } = req.query;

      // Parse dates
      const start = startDate ? new Date(startDate as string) : new Date(0);
      const end = endDate ? new Date(endDate as string) : new Date();
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);

      // Get orders in date range with order items and cashier info
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
          cashier: {
            select: { id: true, fullName: true, email: true }
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      // Calculate limit
      const limitNum = Math.min(parseInt(limit as string) || 100, 1000);

      // Process orders to calculate profit/loss
      const orderProfitDetails = orders.map((order) => {
        const subtotal = decimalToNumber(order.subtotal) ?? 0;
        const total = decimalToNumber(order.total) ?? 0;

        // Calculate total cost from order items
        const totalCost = order.orderItems.reduce((sum, item) => {
          const costPrice = decimalToNumber(item.costPrice);
          const netWeightKg = decimalToNumber(item.netWeightKg) ?? 0;
          if (costPrice != null) {
            return sum + (costPrice * netWeightKg);
          }
          return sum;
        }, 0);

        const totalProfit = total - totalCost;
        const profitMargin = total > 0 ? (totalProfit / total) * 100 : 0;

        return {
          orderId: order.id,
          orderNumber: order.orderNumber,
          cashierId: order.cashierId,
          cashierName: order.cashier?.fullName || 'Unknown',
          cashierEmail: order.cashier?.email || '',
          orderDate: order.createdAt.toISOString(),
          subtotal: Number(subtotal.toFixed(2)),
          total: Number(total.toFixed(2)),
          totalCost: Number(totalCost.toFixed(2)),
          totalProfit: Number(totalProfit.toFixed(2)),
          profitMargin: Number(profitMargin.toFixed(2)),
          itemCount: order.orderItems.length,
          status: order.status,
        };
      });

      // Filter by profit status
      let filteredDetails = orderProfitDetails;
      if (profitStatus === 'profit') {
        filteredDetails = orderProfitDetails.filter(order => order.totalProfit > 0);
      } else if (profitStatus === 'loss') {
        filteredDetails = orderProfitDetails.filter(order => order.totalProfit < 0);
      }

      // Apply limit
      const limitedDetails = filteredDetails.slice(0, limitNum);

      return res.json(limitedDetails);
    } catch (error: any) {
      console.error('Get order profit details error:', error);
      console.error('Error stack:', error.stack);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    }
  }
}


