import { prisma } from '../models/db';

async function cleanPurchasesAndSuppliers() {
  try {
    console.log('🧹 Starting database cleanup for purchases and suppliers...\n');

    // Delete in order to respect foreign key constraints

    console.log('Deleting purchase return items...');
    const returnItems = await prisma.purchaseReturnItem.deleteMany();
    console.log(`✅ Deleted ${returnItems.count} purchase return items`);

    console.log('Deleting purchase returns...');
    const returns = await prisma.purchaseReturn.deleteMany();
    console.log(`✅ Deleted ${returns.count} purchase returns`);

    console.log('Deleting purchase receives...');
    const receives = await prisma.purchaseReceive.deleteMany();
    console.log(`✅ Deleted ${receives.count} purchase receives`);

    console.log('Deleting purchase payments...');
    const payments = await prisma.purchasePayment.deleteMany();
    console.log(`✅ Deleted ${payments.count} purchase payments`);

    console.log('Deleting supplier payment allocations...');
    const allocations = await prisma.supplierPaymentAllocation.deleteMany();
    console.log(`✅ Deleted ${allocations.count} supplier payment allocations`);

    console.log('Deleting purchase items...');
    const items = await prisma.purchaseItem.deleteMany();
    console.log(`✅ Deleted ${items.count} purchase items`);

    console.log('Deleting purchases...');
    const purchases = await prisma.purchase.deleteMany();
    console.log(`✅ Deleted ${purchases.count} purchases`);

    console.log('Deleting supplier credits...');
    const credits = await prisma.supplierCredit.deleteMany();
    console.log(`✅ Deleted ${credits.count} supplier credits`);

    console.log('Deleting suppliers...');
    const suppliers = await prisma.supplier.deleteMany();
    console.log(`✅ Deleted ${suppliers.count} suppliers`);

    console.log('\n✨ Database cleanup completed successfully!');
    console.log('\nSummary:');
    console.log(`- Purchase return items: ${returnItems.count}`);
    console.log(`- Purchase returns: ${returns.count}`);
    console.log(`- Purchase receives: ${receives.count}`);
    console.log(`- Purchase payments: ${payments.count}`);
    console.log(`- Supplier payment allocations: ${allocations.count}`);
    console.log(`- Purchase items: ${items.count}`);
    console.log(`- Purchases: ${purchases.count}`);
    console.log(`- Supplier credits: ${credits.count}`);
    console.log(`- Suppliers: ${suppliers.count}`);

  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

cleanPurchasesAndSuppliers()
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
