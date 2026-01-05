/**
 * Create Initial Supplier Credits for Imported Suppliers
 *
 * This script creates supplier_credits records for suppliers that were imported
 * with outstanding balances but no credit transactions.
 *
 * Run this ONCE after importing suppliers from old system:
 * npm run migrate:supplier-credits
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function createSupplierCredits() {
  console.log('🚀 Creating initial supplier credits for imported suppliers...\n');

  try {
    // Get all suppliers with outstanding balance but no credits
    const suppliers = await prisma.supplier.findMany({
      where: {
        outstandingBalance: { gt: 0 },
      },
      include: {
        supplierCredits: true,
      },
    });

    console.log(`Found ${suppliers.length} suppliers with outstanding balances\n`);

    let createdCount = 0;
    let skippedCount = 0;

    for (const supplier of suppliers) {
      try {
        const outstandingBalance = supplier.outstandingBalance
          ? typeof supplier.outstandingBalance === 'object' && 'toNumber' in supplier.outstandingBalance
            ? supplier.outstandingBalance.toNumber()
            : typeof supplier.outstandingBalance === 'string'
              ? parseFloat(supplier.outstandingBalance)
              : supplier.outstandingBalance
          : 0;

        if (outstandingBalance <= 0) {
          console.log(`⏭️  Skipped: ${supplier.name} - No outstanding balance`);
          skippedCount++;
          continue;
        }

        // Check if supplier already has unpaid credits
        const hasUnpaidCredits = supplier.supplierCredits.some(
          credit =>
            (credit.transactionType === 'admin_credit' || credit.transactionType === 'credit') &&
            (credit.paymentStatus === null || credit.paymentStatus === 'unpaid' || credit.paymentStatus === 'partial')
        );

        if (hasUnpaidCredits) {
          console.log(`⏭️  Skipped: ${supplier.name} - Already has unpaid credits`);
          skippedCount++;
          continue;
        }

        // Create initial credit record for imported balance
        const credit = await prisma.supplierCredit.create({
          data: {
            supplierId: supplier.id,
            transactionType: 'admin_credit',
            amount: outstandingBalance,
            balance: outstandingBalance,
            paidAmount: 0,
            paymentStatus: 'unpaid',
            description: 'Initial balance from old system (imported data)',
            createdAt: supplier.createdAt, // Use supplier creation date
          },
        });

        console.log(`✅ Created: ${supplier.name}`);
        console.log(`   - Credit ID: ${credit.id}`);
        console.log(`   - Amount: LKR ${outstandingBalance.toFixed(2)}`);
        console.log(`   - Description: ${credit.description}`);
        console.log('');

        createdCount++;
      } catch (error: any) {
        console.error(`❌ Error creating credit for ${supplier.name}:`, error.message);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 Migration Summary:');
    console.log('='.repeat(60));
    console.log(`✅ Credits Created: ${createdCount}`);
    console.log(`⏭️  Suppliers Skipped: ${skippedCount}`);
    console.log('='.repeat(60));

    if (createdCount > 0) {
      console.log('\n🎉 Success! Initial supplier credits created.');
      console.log('📝 Note: All credits were marked as "unpaid" and can now be paid via the payment system.');
      console.log('\n💡 Next Steps:');
      console.log('   1. Verify credits in admin panel → Suppliers');
      console.log('   2. Make test payment to ensure FIFO allocation works');
      console.log('   3. Suppliers can now receive payments properly');
    }

  } catch (error: any) {
    console.error('❌ Fatal error during migration:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the migration
createSupplierCredits()
  .then(() => {
    console.log('\n✅ Migration completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  });
