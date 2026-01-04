/**
 * Migration Script: Create Initial Batches for Existing Inventory
 *
 * This script creates stock batches for all products that have existing inventory
 * but no batches. This is needed when migrating from the old system to batch tracking.
 *
 * Run this ONCE after deploying the batch tracking feature:
 * npx tsx src/scripts/create-initial-batches.ts
 */

import { PrismaClient } from '@prisma/client';
import { createStockBatch } from '../services/batchService';

const prisma = new PrismaClient();

async function createInitialBatches() {
  console.log('🚀 Starting initial batch creation for existing inventory...\n');

  try {
    // Get all products with stock but no batches
    const products = await prisma.product.findMany({
      where: {
        stockQuantity: { gt: 0 },
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        stockQuantity: true,
        costPrice: true,
        sku: true,
      },
    });

    console.log(`Found ${products.length} products with existing inventory\n`);

    let createdCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const product of products) {
      try {
        // Check if product already has batches
        const existingBatches = await prisma.stockBatch.findMany({
          where: { productId: product.id },
        });

        if (existingBatches.length > 0) {
          console.log(`⏭️  Skipped: ${product.name} (ID: ${product.id}) - Already has ${existingBatches.length} batch(es)`);
          skippedCount++;
          continue;
        }

        // Get stock quantity
        const stockQty = product.stockQuantity
          ? typeof product.stockQuantity === 'object' && 'toNumber' in product.stockQuantity
            ? product.stockQuantity.toNumber()
            : typeof product.stockQuantity === 'string'
              ? parseFloat(product.stockQuantity)
              : product.stockQuantity
          : 0;

        // Get cost price (use 0 if not set)
        const costPrice = product.costPrice
          ? typeof product.costPrice === 'object' && 'toNumber' in product.costPrice
            ? product.costPrice.toNumber()
            : typeof product.costPrice === 'string'
              ? parseFloat(product.costPrice)
              : product.costPrice
          : 0;

        // Create initial batch
        const batch = await createStockBatch(
          product.id,
          stockQty,
          costPrice,
          {
            receivedDate: new Date(), // Use current date as received date
            notes: 'Initial inventory batch created during migration to batch tracking system',
          }
        );

        console.log(`✅ Created: ${product.name} (ID: ${product.id})`);
        console.log(`   - Batch: ${batch.batchNumber}`);
        console.log(`   - Quantity: ${stockQty}`);
        console.log(`   - Cost Price: $${costPrice.toFixed(2)}`);
        console.log('');

        createdCount++;
      } catch (error: any) {
        console.error(`❌ Error creating batch for ${product.name} (ID: ${product.id}):`, error.message);
        errorCount++;
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 Migration Summary:');
    console.log('='.repeat(60));
    console.log(`✅ Batches Created: ${createdCount}`);
    console.log(`⏭️  Products Skipped: ${skippedCount} (already had batches)`);
    console.log(`❌ Errors: ${errorCount}`);
    console.log('='.repeat(60));

    if (createdCount > 0) {
      console.log('\n🎉 Success! Initial batches created.');
      console.log('📝 Note: All batches were created with today\'s date as the received date.');
      console.log('📝 Note: Products without cost price were given $0.00 cost price.');
      console.log('\n💡 Next Steps:');
      console.log('   1. Review created batches in admin panel');
      console.log('   2. Update cost prices if needed');
      console.log('   3. Future inventory will automatically create batches when received');
    }

  } catch (error: any) {
    console.error('❌ Fatal error during migration:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the migration
createInitialBatches()
  .then(() => {
    console.log('\n✅ Migration completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  });
