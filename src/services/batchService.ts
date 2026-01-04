import { PrismaClient, Prisma } from '@prisma/client';
import { decimalToNumber } from '../utils/decimal';

const prisma = new PrismaClient();

export interface BatchAllocation {
  batchId: number;
  batchNumber: string;
  quantityToUse: number;
  costPrice: number;
  receivedDate: Date;
}

export interface BatchDeductionResult {
  success: boolean;
  allocations: BatchAllocation[];
  totalCost: number;
  averageCostPrice: number;
  message?: string;
}

/**
 * Generate a unique batch number
 * Format: BATCH-YYYYMMDD-PRODUCTID-XXXX
 */
export async function generateBatchNumber(productId: number): Promise<string> {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const randomSuffix = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  let batchNumber = `BATCH-${dateStr}-P${productId}-${randomSuffix}`;

  // Ensure uniqueness
  let batchExists = await prisma.stockBatch.findUnique({ where: { batchNumber } });
  let attempts = 0;
  while (batchExists && attempts < 10) {
    const newSuffix = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    batchNumber = `BATCH-${dateStr}-P${productId}-${newSuffix}`;
    batchExists = await prisma.stockBatch.findUnique({ where: { batchNumber } });
    attempts++;
  }

  if (batchExists) {
    throw new Error('Failed to generate unique batch number');
  }

  return batchNumber;
}

/**
 * Create a new stock batch when receiving inventory
 */
export async function createStockBatch(
  productId: number,
  quantity: number,
  costPrice: number,
  options: {
    purchaseId?: number;
    purchaseReceiveId?: number;
    supplierId?: number;
    receivedDate?: Date;
    expiryDate?: Date;
    notes?: string;
  },
  tx?: Prisma.TransactionClient
): Promise<any> {
  const db = tx || prisma;

  const batchNumber = await generateBatchNumber(productId);

  const batch = await db.stockBatch.create({
    data: {
      productId,
      batchNumber,
      quantityReceived: quantity,
      quantityRemaining: quantity,
      costPrice,
      purchaseId: options.purchaseId,
      purchaseReceiveId: options.purchaseReceiveId,
      supplierId: options.supplierId,
      receivedDate: options.receivedDate || new Date(),
      expiryDate: options.expiryDate,
      notes: options.notes,
    },
  });

  // Update product cost price to reflect new weighted average
  // This happens after batch is created, so cost price updates with new batch included
  await updateProductCostPrice(productId, db);

  return batch;
}

/**
 * Get available batches for a product using FIFO (oldest first)
 */
export async function getAvailableBatches(
  productId: number,
  tx?: Prisma.TransactionClient
): Promise<any[]> {
  const db = tx || prisma;

  const batches = await db.stockBatch.findMany({
    where: {
      productId,
      quantityRemaining: { gt: 0 },
    },
    orderBy: {
      receivedDate: 'asc', // FIFO: oldest first
    },
    include: {
      supplier: {
        select: {
          name: true,
        },
      },
      purchase: {
        select: {
          purchaseNumber: true,
        },
      },
    },
  });

  return batches;
}

/**
 * Deduct quantity from stock batches using FIFO method
 * Returns allocation details for recording in OrderItemBatch
 */
export async function deductFromBatchesFIFO(
  productId: number,
  quantityNeeded: number,
  tx?: Prisma.TransactionClient
): Promise<BatchDeductionResult> {
  const db = tx || prisma;

  const availableBatches = await getAvailableBatches(productId, db);

  if (availableBatches.length === 0) {
    return {
      success: false,
      allocations: [],
      totalCost: 0,
      averageCostPrice: 0,
      message: 'No batches available for this product',
    };
  }

  // Calculate total available quantity
  const totalAvailable = availableBatches.reduce(
    (sum, batch) => sum + decimalToNumber(batch.quantityRemaining)!,
    0
  );

  if (totalAvailable < quantityNeeded) {
    return {
      success: false,
      allocations: [],
      totalCost: 0,
      averageCostPrice: 0,
      message: `Insufficient batch stock. Available: ${totalAvailable.toFixed(3)}, Needed: ${quantityNeeded.toFixed(3)}`,
    };
  }

  // Allocate quantity using FIFO
  const allocations: BatchAllocation[] = [];
  let remainingQuantity = quantityNeeded;
  let totalCost = 0;

  for (const batch of availableBatches) {
    if (remainingQuantity <= 0) break;

    const batchAvailable = decimalToNumber(batch.quantityRemaining)!;
    const quantityToUse = Math.min(remainingQuantity, batchAvailable);
    const costPrice = decimalToNumber(batch.costPrice)!;

    allocations.push({
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      quantityToUse,
      costPrice,
      receivedDate: batch.receivedDate,
    });

    totalCost += quantityToUse * costPrice;
    remainingQuantity -= quantityToUse;

    // Update batch quantity
    const newQuantityRemaining = batchAvailable - quantityToUse;
    await db.stockBatch.update({
      where: { id: batch.id },
      data: { quantityRemaining: newQuantityRemaining },
    });
  }

  const averageCostPrice = quantityNeeded > 0 ? totalCost / quantityNeeded : 0;

  // Update product cost price to reflect new weighted average
  // This happens after batches are deducted, so cost price updates automatically
  await updateProductCostPrice(productId, db);

  return {
    success: true,
    allocations,
    totalCost,
    averageCostPrice,
  };
}

/**
 * Deduct from specific batches (manual selection on POS)
 * Accepts an array of batch allocations with desired quantities
 */
export async function deductFromSpecificBatches(
  productId: number,
  batchAllocations: Array<{ batchId: number; quantity: number }>,
  tx?: Prisma.TransactionClient
): Promise<BatchDeductionResult> {
  const db = tx || prisma;

  // Validate all batches exist and have sufficient quantity
  const batchIds = batchAllocations.map(a => a.batchId);
  const batches = await db.stockBatch.findMany({
    where: {
      id: { in: batchIds },
      productId,
    },
  });

  if (batches.length !== batchIds.length) {
    return {
      success: false,
      allocations: [],
      totalCost: 0,
      averageCostPrice: 0,
      message: 'One or more batches not found',
    };
  }

  const allocations: BatchAllocation[] = [];
  let totalCost = 0;
  let totalQuantity = 0;

  for (const allocation of batchAllocations) {
    const batch = batches.find(b => b.id === allocation.batchId);
    if (!batch) continue;

    const batchAvailable = decimalToNumber(batch.quantityRemaining)!;
    if (batchAvailable < allocation.quantity) {
      return {
        success: false,
        allocations: [],
        totalCost: 0,
        averageCostPrice: 0,
        message: `Batch ${batch.batchNumber} has insufficient quantity. Available: ${batchAvailable.toFixed(3)}, Requested: ${allocation.quantity.toFixed(3)}`,
      };
    }

    const costPrice = decimalToNumber(batch.costPrice)!;

    allocations.push({
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      quantityToUse: allocation.quantity,
      costPrice,
      receivedDate: batch.receivedDate,
    });

    totalCost += allocation.quantity * costPrice;
    totalQuantity += allocation.quantity;

    // Update batch quantity
    const newQuantityRemaining = batchAvailable - allocation.quantity;
    await db.stockBatch.update({
      where: { id: batch.id },
      data: { quantityRemaining: newQuantityRemaining },
    });
  }

  const averageCostPrice = totalQuantity > 0 ? totalCost / totalQuantity : 0;

  // Update product cost price to reflect new weighted average
  await updateProductCostPrice(productId, db);

  return {
    success: true,
    allocations,
    totalCost,
    averageCostPrice,
  };
}

/**
 * Create order item batch records
 */
export async function createOrderItemBatches(
  orderItemId: number,
  allocations: BatchAllocation[],
  tx?: Prisma.TransactionClient
): Promise<void> {
  const db = tx || prisma;

  for (const allocation of allocations) {
    await db.orderItemBatch.create({
      data: {
        orderItemId,
        stockBatchId: allocation.batchId,
        quantityUsed: allocation.quantityToUse,
        costPrice: allocation.costPrice,
        batchNumber: allocation.batchNumber,
      },
    });
  }
}

/**
 * Get batch details for a product (for POS display)
 */
export async function getBatchesForProduct(
  productId: number
): Promise<any[]> {
  const batches = await prisma.stockBatch.findMany({
    where: {
      productId,
      quantityRemaining: { gt: 0 },
    },
    orderBy: {
      receivedDate: 'asc',
    },
    include: {
      supplier: {
        select: {
          name: true,
        },
      },
    },
  });

  return batches.map(batch => ({
    id: batch.id,
    batchNumber: batch.batchNumber,
    receivedDate: batch.receivedDate,
    quantityRemaining: decimalToNumber(batch.quantityRemaining),
    costPrice: decimalToNumber(batch.costPrice),
    supplierName: batch.supplier?.name || null,
    notes: batch.notes,
  }));
}

/**
 * Get total available quantity across all batches for a product
 */
export async function getTotalBatchQuantity(
  productId: number,
  tx?: Prisma.TransactionClient
): Promise<number> {
  const db = tx || prisma;

  const batches = await db.stockBatch.findMany({
    where: {
      productId,
      quantityRemaining: { gt: 0 },
    },
    select: {
      quantityRemaining: true,
    },
  });

  return batches.reduce(
    (sum, batch) => sum + decimalToNumber(batch.quantityRemaining)!,
    0
  );
}

/**
 * Calculate weighted average cost price for a product based on remaining batches
 * Formula: Σ(Batch Qty × Batch Cost) / Σ(Batch Qty)
 *
 * This should be called after every batch addition or deduction to keep
 * product cost price accurate and reflecting current inventory
 */
export async function calculateWeightedAverageCost(
  productId: number,
  tx?: Prisma.TransactionClient
): Promise<number> {
  const db = tx || prisma;

  const batches = await db.stockBatch.findMany({
    where: {
      productId,
      quantityRemaining: { gt: 0 },
    },
    select: {
      quantityRemaining: true,
      costPrice: true,
    },
  });

  if (batches.length === 0) {
    return 0; // No batches = no cost
  }

  let totalCost = 0;
  let totalQuantity = 0;

  for (const batch of batches) {
    const qty = decimalToNumber(batch.quantityRemaining)!;
    const cost = decimalToNumber(batch.costPrice)!;
    totalCost += qty * cost;
    totalQuantity += qty;
  }

  return totalQuantity > 0 ? totalCost / totalQuantity : 0;
}

/**
 * Update product's cost price to reflect weighted average of remaining batches
 * Also updates stock quantity to match total from batches
 *
 * This ensures:
 * 1. Cost price = weighted average of remaining batches (for display/estimates)
 * 2. Stock quantity = sum of all batch quantities (accurate inventory count)
 */
export async function updateProductCostPrice(
  productId: number,
  tx?: Prisma.TransactionClient
): Promise<void> {
  const db = tx || prisma;

  // Calculate weighted average cost from remaining batches
  const weightedAvgCost = await calculateWeightedAverageCost(productId, db);

  // Calculate total stock from batches
  const totalStock = await getTotalBatchQuantity(productId, db);

  // Update product
  await db.product.update({
    where: { id: productId },
    data: {
      costPrice: weightedAvgCost,
      stockQuantity: totalStock,
    },
  });
}
