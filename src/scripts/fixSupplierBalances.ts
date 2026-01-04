import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Fix supplier outstanding balances by recalculating from credit ledger
 * This script syncs Supplier.outstandingBalance with the latest SupplierCredit.balance
 */
async function fixSupplierBalances() {
  console.log('🔧 Starting supplier balance sync...\n');

  try {
    // Get all suppliers
    const suppliers = await prisma.supplier.findMany({
      where: {
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        outstandingBalance: true,
      },
    });

    console.log(`Found ${suppliers.length} suppliers to check\n`);

    let fixedCount = 0;

    for (const supplier of suppliers) {
      // Get the latest credit record for this supplier (has the correct running balance)
      const latestCredit = await prisma.supplierCredit.findFirst({
        where: {
          supplierId: supplier.id,
        },
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          balance: true,
          createdAt: true,
        },
      });

      if (!latestCredit) {
        // No credits for this supplier, balance should be 0
        const currentBalance = Number(supplier.outstandingBalance) || 0;
        if (currentBalance !== 0) {
          console.log(`📝 ${supplier.name} (ID: ${supplier.id})`);
          console.log(`   Current: ${currentBalance}`);
          console.log(`   Correct: 0 (no credits)`);
          console.log(`   → Updating to 0\n`);

          await prisma.supplier.update({
            where: { id: supplier.id },
            data: { outstandingBalance: 0 },
          });

          fixedCount++;
        }
      } else {
        // Compare supplier balance with latest credit balance
        const correctBalance = Number(latestCredit.balance) || 0;
        const currentBalance = Number(supplier.outstandingBalance) || 0;

        if (Math.abs(correctBalance - currentBalance) > 0.01) {
          // There's a discrepancy
          console.log(`📝 ${supplier.name} (ID: ${supplier.id})`);
          console.log(`   Current: ${currentBalance.toFixed(2)}`);
          console.log(`   Correct: ${correctBalance.toFixed(2)} (from ledger)`);
          console.log(`   → Updating to ${correctBalance.toFixed(2)}\n`);

          await prisma.supplier.update({
            where: { id: supplier.id },
            data: { outstandingBalance: correctBalance },
          });

          fixedCount++;
        } else {
          console.log(`✅ ${supplier.name} (ID: ${supplier.id}) - Balance correct: ${correctBalance.toFixed(2)}`);
        }
      }
    }

    console.log('\n' + '='.repeat(50));
    console.log(`✅ Sync complete!`);
    console.log(`   Total suppliers checked: ${suppliers.length}`);
    console.log(`   Balances fixed: ${fixedCount}`);
    console.log(`   Already correct: ${suppliers.length - fixedCount}`);
    console.log('='.repeat(50));
  } catch (error) {
    console.error('❌ Error fixing supplier balances:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
fixSupplierBalances()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
