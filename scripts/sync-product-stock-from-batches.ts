import { PrismaClient } from '@prisma/client';
import { decimalToNumber } from '../src/utils/decimal';

const prisma = new PrismaClient();

/**
 * Recalculate and sync all product stock quantities from their batches
 *
 * This script fixes the issue where:
 * - Batches show correct remaining quantities
 * - Products show incorrect/outdated stock quantities (often 0)
 *
 * It recalculates:
 * 1. Stock quantity = sum of all batch quantityRemaining
 * 2. Cost price = weighted average of batch costs
 */
async function syncProductStockFromBatches() {
  console.log('🔄 Syncing product stock quantities from batches...\n');

  try {
    // Get all products that have batches
    const products = await prisma.product.findMany({
      include: {
        stockBatches: {
          where: {
            quantityRemaining: { gt: 0 }
          }
        }
      }
    });

    let updatedCount = 0;
    let skippedCount = 0;
    let fixedProducts: Array<{
      id: number;
      name: string;
      sku: string;
      oldStock: number;
      newStock: number;
      oldCost: number;
      newCost: number;
      batchCount: number;
    }> = [];

    for (const product of products) {
      const oldStock = decimalToNumber(product.stockQuantity) || 0;
      const oldCost = decimalToNumber(product.costPrice) || 0;

      if (product.stockBatches.length === 0) {
        // No batches with remaining quantity
        if (oldStock !== 0) {
          // Product shows stock but has no batches - set to 0
          await prisma.product.update({
            where: { id: product.id },
            data: {
              stockQuantity: 0,
              costPrice: 0
            }
          });

          fixedProducts.push({
            id: product.id,
            name: product.name,
            sku: product.sku,
            oldStock,
            newStock: 0,
            oldCost,
            newCost: 0,
            batchCount: 0
          });
          updatedCount++;
        } else {
          skippedCount++;
        }
        continue;
      }

      // Calculate total stock from batches
      let totalStock = 0;
      let totalCost = 0;
      let totalValue = 0;

      for (const batch of product.stockBatches) {
        const qty = decimalToNumber(batch.quantityRemaining) || 0;
        const cost = decimalToNumber(batch.costPrice) || 0;

        totalStock += qty;
        totalValue += qty * cost;
      }

      // Calculate weighted average cost
      const weightedAvgCost = totalStock > 0 ? totalValue / totalStock : 0;

      // Check if update is needed
      const stockDiff = Math.abs(totalStock - oldStock);
      const costDiff = Math.abs(weightedAvgCost - oldCost);

      if (stockDiff > 0.001 || costDiff > 0.001) {
        // Update product
        await prisma.product.update({
          where: { id: product.id },
          data: {
            stockQuantity: totalStock,
            costPrice: weightedAvgCost
          }
        });

        fixedProducts.push({
          id: product.id,
          name: product.name,
          sku: product.sku,
          oldStock,
          newStock: totalStock,
          oldCost,
          newCost: weightedAvgCost,
          batchCount: product.stockBatches.length
        });
        updatedCount++;
      } else {
        skippedCount++;
      }
    }

    console.log('============================================================');
    console.log('📊 Sync Summary:');
    console.log('============================================================');
    console.log(`✅ Products Updated: ${updatedCount}`);
    console.log(`⏭️  Products Skipped (already in sync): ${skippedCount}`);
    console.log(`📦 Total Products Checked: ${products.length}`);
    console.log('============================================================\n');

    if (fixedProducts.length > 0) {
      console.log('📋 Fixed Products:\n');

      // Sort by biggest stock difference
      fixedProducts.sort((a, b) => Math.abs(b.newStock - b.oldStock) - Math.abs(a.newStock - a.oldStock));

      fixedProducts.forEach(product => {
        const stockChange = product.newStock - product.oldStock;
        const stockChangeStr = stockChange >= 0 ? `+${stockChange.toFixed(3)}` : stockChange.toFixed(3);

        console.log(`✅ ${product.name} (SKU: ${product.sku})`);
        console.log(`   ID: ${product.id}`);
        console.log(`   Stock: ${product.oldStock.toFixed(3)} → ${product.newStock.toFixed(3)} (${stockChangeStr})`);
        console.log(`   Cost Price: LKR ${product.oldCost.toFixed(2)} → LKR ${product.newCost.toFixed(2)}`);
        console.log(`   Active Batches: ${product.batchCount}`);
        console.log('');
      });
    }

    console.log('🎉 Stock synchronization completed successfully!\n');

    console.log('💡 Next Steps:');
    console.log('   1. Check products page - stock should now match batches');
    console.log('   2. Verify any previously "Out of Stock" items now show correct quantities');
    console.log('   3. This sync will happen automatically after each sale/purchase in the future\n');

  } catch (error: any) {
    console.error('❌ Error syncing product stock:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the sync
syncProductStockFromBatches()
  .then(() => {
    console.log('✅ Script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
