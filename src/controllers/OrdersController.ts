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
import { parseLimit } from '../config/pagination';
import {
  deductFromBatchesFIFO,
  deductFromSpecificBatches,
  createOrderItemBatches,
  updateProductCostPrice
} from '../services/batchService';

export class OrdersController {
  static async getOrders(req: AuthRequest, res: Response) {
    try {
      const {
        id,
        orderNumber,
        cashierId,
        registrySessionId, // TEAM_003: Support filtering by registry session
        status,
        paymentMethod,
        search,
        startDate,
        endDate,
        limit,
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
        if (status !== 'completed' && status !== 'voided' && status !== 'pending') {
          return res.status(400).json({
            error: "Status must be 'completed', 'voided', or 'pending'",
            code: "INVALID_STATUS"
          });
        }
        where.status = status;
      }

      // Filter by payment method
      if (paymentMethod) {
        where.paymentMethod = paymentMethod as string;
      }

      // Search by order number or customer name
      if (search) {
        where.OR = [
          { orderNumber: { contains: search as string, mode: 'insensitive' } },
          { customer: { name: { contains: search as string, mode: 'insensitive' } } }
        ];
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
        take: parseLimit(limit, 'orders'),
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
        // Credit balance tracking
        customerPreviousBalance = 0, // Customer's unpaid balance before this order
        creditUsed = 0, // Amount of credit used to pay for this order
        amountPaid, // Actual amount paid (cash/card/cheque)
        paidToAdmin = 0, // Payment to admin credit (manual liability)
        paidToOldOrders = 0, // Payment to old order credits
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

      // CRITICAL FIX EDGE-001: Check stock availability BEFORE processing order
      // Collect all product IDs that need stock validation
      const productStockChecks: Array<{ productId: number; requiredQuantity: number; itemName: string }> = [];

      for (const rawItem of items) {
        if (rawItem.productId) {
          const productId = parseInt(rawItem.productId);
          const quantityType = rawItem.quantityType || 'kg';

          // Calculate required quantity based on type
          let requiredQuantity = 0;
          if (quantityType === 'kg' || quantityType === 'g' || quantityType === 'box') {
            // For weight-based items, calculate net weight
            const itemWeightKg = parseFloat(rawItem.itemWeightKg) || 0;
            const itemWeightG = parseFloat(rawItem.itemWeightG) || 0;
            const itemWeightTotalKg = itemWeightKg + (itemWeightG / 1000);

            const boxWeightKg = rawItem.boxWeightKg ? parseFloat(rawItem.boxWeightKg) : 0;
            const boxWeightG = rawItem.boxWeightG ? parseFloat(rawItem.boxWeightG) : 0;
            const boxCount = rawItem.boxCount ? parseInt(rawItem.boxCount) : 0;
            const boxWeightPerBoxKg = boxWeightKg + (boxWeightG / 1000);
            const totalBoxWeightKg = boxWeightPerBoxKg * boxCount;

            requiredQuantity = itemWeightTotalKg - totalBoxWeightKg;
          } else {
            // For unit-based items
            requiredQuantity = rawItem.boxCount ? parseInt(rawItem.boxCount) : 1;
          }

          productStockChecks.push({
            productId,
            requiredQuantity,
            itemName: rawItem.itemName || 'Unknown Item'
          });
        }
      }

      // PERFORMANCE OPTIMIZATION: Batch query all products at once instead of individual queries
      const productIds = productStockChecks.map(check => check.productId);
      const products = await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, stockQuantity: true, name: true, unitType: true },
      });

      // Create a map for quick lookup
      const productMap = new Map(products.map(p => [p.id, p]));

      // Validate stock for all products
      for (const check of productStockChecks) {
        const product = productMap.get(check.productId);

        if (product) {
          const currentStock = decimalToNumber(product.stockQuantity) || 0;

          // CRITICAL: Prevent sale if insufficient stock
          if (currentStock < check.requiredQuantity) {
            return res.status(400).json({
              error: `Insufficient stock for ${product.name || check.itemName}. Available: ${currentStock.toFixed(3)}, Required: ${check.requiredQuantity.toFixed(3)}`,
              code: 'INSUFFICIENT_STOCK',
              productId: check.productId,
              productName: product.name || check.itemName,
              availableStock: currentStock,
              requiredStock: check.requiredQuantity,
            });
          }

          // CRITICAL: Prevent sale if stock is zero or negative
          if (currentStock <= 0) {
            return res.status(400).json({
              error: `Product ${product.name || check.itemName} is out of stock`,
              code: 'OUT_OF_STOCK',
              productId: check.productId,
              productName: product.name || check.itemName,
            });
          }
        }
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

        // Calculate payment breakdown
        const parsedCreditUsed = creditUsed ? parseFloat(creditUsed.toString()) : 0;
        // IMPORTANT: Check for undefined/null, not falsy (0 is valid for credit orders!)
        const parsedAmountPaid = amountPaid !== undefined && amountPaid !== null
          ? parseFloat(amountPaid.toString())
          : orderTotals.total;

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
            creditUsed: parsedCreditUsed, // Credit balance used for this order
            amountPaid: parsedAmountPaid, // Actual cash/card paid
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

          // Use FIFO batch tracking for cost price if product exists
          let costPrice: number | null = null;
          let batchDeductionResult = null;

          if (calculatedItem.productId && calculatedItem.netWeightKg > 0) {
            // Check if frontend provided specific batch allocations (manual override)
            const itemBatchAllocations = (calculatedItem as any).batchAllocations;

            if (itemBatchAllocations && Array.isArray(itemBatchAllocations) && itemBatchAllocations.length > 0) {
              // Manual batch selection from POS
              batchDeductionResult = await deductFromSpecificBatches(
                calculatedItem.productId,
                itemBatchAllocations,
                tx
              );
            } else {
              // Automatic FIFO batch deduction
              batchDeductionResult = await deductFromBatchesFIFO(
                calculatedItem.productId,
                calculatedItem.netWeightKg,
                tx
              );
            }

            if (batchDeductionResult.success) {
              costPrice = batchDeductionResult.averageCostPrice;
              console.log(`✅ Allocated ${calculatedItem.netWeightKg}kg from ${batchDeductionResult.allocations.length} batch(es) at avg cost: ${costPrice.toFixed(2)}`);
            } else {
              // Fallback to product cost price if batch deduction fails
              console.warn(`⚠️ Batch deduction failed: ${batchDeductionResult.message}. Falling back to product cost price.`);
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
            }
          } else if (product && product.costPrice != null) {
            // Non-tracked products or manual items - use product cost price
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

          // Create OrderItemBatch records if batch deduction was successful
          if (batchDeductionResult && batchDeductionResult.success && batchDeductionResult.allocations.length > 0) {
            await createOrderItemBatches(orderItem.id, batchDeductionResult.allocations, tx);
            console.log(`✅ Created ${batchDeductionResult.allocations.length} batch allocation record(s) for order item`);
          }

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

          // CRITICAL FIX: Sync product stock from batches after deduction
          // The batch service already deducted from batches above (deductFromBatchesFIFO)
          // Now we need to update the product's stockQuantity to match the batch totals
          // This replaces the old manual calculation which was causing sync issues
          if (calculatedItem.productId) {
            // Get product info for logging purposes
            const product = await tx.product.findUnique({
              where: { id: calculatedItem.productId },
              select: { stockQuantity: true, unitType: true },
            });

            if (product) {
              // Calculate quantity deducted for stock movement logging
              let quantityToDeduct = 0;
              if (product.unitType === 'weight') {
                // For weight-based, use exact net weight in kg
                quantityToDeduct = calculatedItem.netWeightKg;
              } else {
                // For unit-based, use box count or quantity
                quantityToDeduct = calculatedItem.boxCount || 1;
              }

              // OLD APPROACH (BUGGY): Manual calculation by subtraction
              // This was overriding the correct batch-based sync!
              // const newStockQuantity = currentStock - quantityToDeduct;

              // NEW APPROACH (CORRECT): Sync stock from batch totals
              // This ensures product.stockQuantity always equals sum of batch quantities
              await updateProductCostPrice(calculatedItem.productId, tx);
              console.log(`✅ Stock synced from batches for product ${calculatedItem.productId}`);

              // Get updated stock quantity after sync for logging
              const updatedProduct = await tx.product.findUnique({
                where: { id: calculatedItem.productId },
                select: { stockQuantity: true },
              });

              const newStockQuantity = updatedProduct ? decimalToNumber(updatedProduct.stockQuantity) || 0 : 0;
              console.log(`Final stock after batch sync: ${newStockQuantity.toFixed(3)}`);

              // Create stock movement record for audit trail
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
            const paymentType = payment.type || paymentMethod;

            // Ensure cheque payments always store the cheque number as reference
            let reference: string | null = payment.reference || null;
            if (!reference && paymentType === 'cheque' && payment.chequeDetails?.chequeNumber) {
              reference = payment.chequeDetails.chequeNumber;
            }

            await tx.paymentDetail.create({
              data: {
                orderId: order.id,
                paymentType,
                amount: parseFloat(payment.amount) || 0,
                cardType: payment.cardType || null,
                reference,
              },
            });
          }
        } else if (paymentMethod !== 'cash') {
          // Create single payment detail for non-cash payments
          let reference: string | null = req.body.reference || null;

          // Fallback for single cheque payments: use cheque number as reference
          if (!reference && paymentMethod === 'cheque' && req.body.chequeDetails?.chequeNumber) {
            reference = req.body.chequeDetails.chequeNumber;
          }

          await tx.paymentDetail.create({
            data: {
              orderId: order.id,
              paymentType: paymentMethod,
              amount: orderTotals.total,
              cardType: req.body.cardType || null,
              reference,
            },
          });
        }

        // Update customer stats if customer exists (using backend-calculated total)
        if (customerId) {
          const customerIdNum = parseInt(customerId);

          // Calculate new credit balance
          // Total Due = Previous Balance + Current Order
          // Remaining Balance = Total Due - Amount Paid
          const parsedPreviousBalance = parseFloat(customerPreviousBalance.toString()) || 0;
          const totalDue = parsedPreviousBalance + orderTotals.total;
          const totalPaid = parsedAmountPaid + parsedCreditUsed;
          const remainingBalance = totalDue - totalPaid;

          // Update customer stats and credit balance
          await tx.customer.update({
            where: { id: customerIdNum },
            data: {
              totalPurchases: { increment: orderTotals.total },
              visitCount: { increment: 1 },
              creditBalance: remainingBalance, // Update to new remaining balance
            },
          });

          // Create CustomerCredit transactions for payments
          const parsedPaidToAdmin = parseFloat(paidToAdmin.toString()) || 0;
          const parsedPaidToOldOrders = parseFloat(paidToOldOrders.toString()) || 0;

          // Transaction 1: Payment to admin credit (if any)
          if (parsedPaidToAdmin > 0) {
            const balanceAfterAdmin = parsedPreviousBalance - parsedPaidToAdmin;
            await tx.customerCredit.create({
              data: {
                customerId: customerIdNum,
                orderId: order.id,
                transactionType: 'credit_used',
                amount: parsedPaidToAdmin,
                balance: balanceAfterAdmin,
                description: `Admin credit payment for Order #${orderNumber}`,
                userId: parseInt(cashierId),
              },
            });
          }

          // Transaction 2: Payment to old orders (if any)
          if (parsedPaidToOldOrders > 0) {
            const balanceAfterOldOrders = parsedPreviousBalance - parsedPaidToAdmin - parsedPaidToOldOrders;
            await tx.customerCredit.create({
              data: {
                customerId: customerIdNum,
                orderId: order.id,
                transactionType: 'credit_used',
                amount: parsedPaidToOldOrders,
                balance: balanceAfterOldOrders,
                description: `Old order payment for Order #${orderNumber}`,
                userId: parseInt(cashierId),
              },
            });
          }

          // Transaction 3: Unpaid current order (if any)
          const unpaidCurrent = orderTotals.total - parsedAmountPaid;
          if (unpaidCurrent > 0) {
            await tx.customerCredit.create({
              data: {
                customerId: customerIdNum,
                orderId: order.id,
                transactionType: 'credit_added',
                amount: unpaidCurrent,
                balance: remainingBalance,
                description: `Unpaid amount for Order #${orderNumber}`,
                userId: parseInt(cashierId),
              },
            });
          }
        }

        // Handle cheque payments - create cheque records
        if (payments && Array.isArray(payments)) {
          const chequePayments = payments.filter((p: any) => p.type === 'cheque');

          for (const chequePayment of chequePayments) {
            if (chequePayment.chequeDetails) {
              const {
                chequeNumber,
                chequeDate,
                payerName,
                payeeName,
                bankName,
                branchName,
                notes,
              } = chequePayment.chequeDetails;

              await tx.cheque.create({
                data: {
                  chequeNumber,
                  chequeDate: new Date(chequeDate),
                  amount: parseFloat(chequePayment.amount),
                  payerName,
                  payeeName: payeeName || null,
                  bankName,
                  branchName: branchName || null,
                  status: 'pending',
                  transactionType: 'received',
                  receivedDate: new Date(),
                  orderId: order.id,
                  customerId: customerId ? parseInt(customerId) : null,
                  userId: parseInt(cashierId),
                  notes: notes || `Cheque received for Order #${orderNumber}`,
                },
              });
            }
          }
        } else if (paymentMethod === 'cheque' && req.body.chequeDetails) {
          // Single cheque payment
          const {
            chequeNumber,
            chequeDate,
            payerName,
            payeeName,
            bankName,
            branchName,
            notes,
          } = req.body.chequeDetails;

          await tx.cheque.create({
            data: {
              chequeNumber,
              chequeDate: new Date(chequeDate),
              amount: orderTotals.total,
              payerName,
              payeeName: payeeName || null,
              bankName,
              branchName: branchName || null,
              status: 'pending',
              transactionType: 'received',
              receivedDate: new Date(),
              orderId: order.id,
              customerId: customerId ? parseInt(customerId) : null,
              userId: parseInt(cashierId),
              notes: notes || `Cheque received for Order #${orderNumber}`,
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

      // Get updated customer balance if customer was specified
      let customerBalance = null;
      if (customerId) {
        const customer = await prisma.customer.findUnique({
          where: { id: parseInt(customerId) },
          select: { creditBalance: true },
        });
        if (customer) {
          customerBalance = {
            remainingBalance: decimalToNumber(customer.creditBalance) ?? 0,
          };
        }
      }

      return res.status(201).json({
        order: serializedOrder,
        customerBalance, // Include customer's remaining balance
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
      const { startDate, endDate, profitStatus = 'all', limit } = req.query;

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
      const limitNum = Math.min(parseLimit(limit, 'orders'), 1000);

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

  static async getOrderStats(req: AuthRequest, res: Response) {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Build where clause based on user role
      const whereClause: any = { status: 'completed' };

      // If cashier, only show their stats
      if (user.role === 'cashier') {
        whereClause.cashierId = user.id;
      }

      // Get today's date range
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // Fetch aggregated data
      const [totalOrdersData, totalRevenueData, todaysOrdersData] = await Promise.all([
        // Total completed orders count
        prisma.order.count({
          where: whereClause
        }),
        // Total revenue from completed orders
        prisma.order.aggregate({
          where: whereClause,
          _sum: {
            total: true
          }
        }),
        // Today's orders count
        prisma.order.count({
          where: {
            ...whereClause,
            createdAt: {
              gte: today,
              lt: tomorrow
            }
          }
        })
      ]);

      const totalOrders = totalOrdersData || 0;
      const totalRevenue = decimalToNumber(totalRevenueData._sum.total) || 0;
      const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
      const todaysOrders = todaysOrdersData || 0;

      return res.json({
        totalOrders,
        totalRevenue: Number(totalRevenue.toFixed(2)),
        avgOrderValue: Number(avgOrderValue.toFixed(2)),
        todaysOrders
      });
    } catch (error: any) {
      console.error('Get order stats error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message
      });
    }
  }
}


