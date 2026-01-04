/**
 * Database Cleanup Script
 * Removes all data except the admin user
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function cleanupDatabase() {
  console.log('🧹 Starting database cleanup...\n');

  try {
    // PHASE 1: Delete Order-related data
    console.log('📦 PHASE 1: Cleaning Order Data...\n');

    console.log('🗑️  Deleting OrderItemBatches...');
    await prisma.orderItemBatch.deleteMany({});
    console.log('   ✅ Done\n');

    console.log('🗑️  Deleting RefundItems...');
    await prisma.refundItem.deleteMany({});
    console.log('   ✅ Done\n');

    console.log('🗑️  Deleting OrderItems...');
    await prisma.orderItem.deleteMany({});
    console.log('   ✅ Done\n');

    console.log('🗑️  Deleting PaymentDetails...');
    await prisma.paymentDetail.deleteMany({});
    console.log('   ✅ Done\n');

    console.log('🗑️  Deleting HoldOrders...');
    await prisma.holdOrder.deleteMany({});
    console.log('   ✅ Done\n');

    console.log('🗑️  Deleting Refunds...');
    await prisma.refund.deleteMany({});
    console.log('   ✅ Done\n');

    console.log('🗑️  Deleting Orders...');
    await prisma.order.deleteMany({});
    console.log('   ✅ Done\n');

    // PHASE 2: Delete Product and Inventory data
    console.log('📦 PHASE 2: Cleaning Product & Inventory Data...\n');

    console.log('🗑️  Deleting PriceChangeHistory...');
    await prisma.priceChangeHistory.deleteMany({});
    console.log('   ✅ Done\n');

    console.log('🗑️  Deleting StockBatches...');
    await prisma.stockBatch.deleteMany({});
    console.log('   ✅ Done\n');

    console.log('🗑️  Deleting StockMovements...');
    await prisma.stockMovement.deleteMany({});
    console.log('   ✅ Done\n');

    console.log('🗑️  Deleting Products...');
    await prisma.product.deleteMany({});
    console.log('   ✅ Done\n');

    console.log('🗑️  Deleting Categories...');
    await prisma.category.deleteMany({});
    console.log('   ✅ Done\n');

    // PHASE 3: Delete Purchase and Supplier data
    console.log('📦 PHASE 3: Cleaning Purchase & Supplier Data...\n');

    console.log('🗑️  Deleting PurchaseReturnItems...');
    await prisma.purchaseReturnItem.deleteMany({});
    console.log('   ✅ Done\n');

    console.log('🗑️  Deleting PurchaseReturns...');
    await prisma.purchaseReturn.deleteMany({});
    console.log('   ✅ Done\n');

    console.log('🗑️  Deleting PurchaseReceives...');
    await prisma.purchaseReceive.deleteMany({});
    console.log('   ✅ Done\n');

    console.log('🗑️  Deleting PurchaseItems...');
    await prisma.purchaseItem.deleteMany({});
    console.log('   ✅ Done\n');

    console.log('🗑️  Deleting PurchasePayments...');
    await prisma.purchasePayment.deleteMany({});
    console.log('   ✅ Done\n');

    console.log('🗑️  Deleting Purchases...');
    await prisma.purchase.deleteMany({});
    console.log('   ✅ Done\n');

    console.log('🗑️  Deleting SupplierPaymentAllocations...');
    await prisma.supplierPaymentAllocation.deleteMany({});
    console.log('   ✅ Done\n');

    console.log('🗑️  Deleting SupplierCredits...');
    await prisma.supplierCredit.deleteMany({});
    console.log('   ✅ Done\n');

    console.log('🗑️  Deleting Suppliers...');
    await prisma.supplier.deleteMany({});
    console.log('   ✅ Done\n');

    // PHASE 4: Delete Customer data
    console.log('📦 PHASE 4: Cleaning Customer Data...\n');

    console.log('🗑️  Deleting CustomerCredits...');
    await prisma.customerCredit.deleteMany({});
    console.log('   ✅ Done\n');

    console.log('🗑️  Deleting Customers...');
    await prisma.customer.deleteMany({});
    console.log('   ✅ Done\n');

    // PHASE 5: Delete Financial data
    console.log('📦 PHASE 5: Cleaning Financial Data...\n');

    console.log('🗑️  Deleting Cheques...');
    await prisma.cheque.deleteMany({});
    console.log('   ✅ Done\n');

    console.log('🗑️  Deleting CashTransactions...');
    await prisma.cashTransaction.deleteMany({});
    console.log('   ✅ Done\n');

    console.log('🗑️  Deleting Expenses...');
    await prisma.expense.deleteMany({});
    console.log('   ✅ Done\n');

    console.log('🗑️  Deleting ExpenseCategories...');
    await prisma.expenseCategory.deleteMany({});
    console.log('   ✅ Done\n');

    // PHASE 6: Delete Registry and Cashier data
    console.log('📦 PHASE 6: Cleaning Registry & Cashier Data...\n');

    console.log('🗑️  Deleting RegistrySessions...');
    await prisma.registrySession.deleteMany({});
    console.log('   ✅ Done\n');

    console.log('🗑️  Deleting CashierShifts...');
    await prisma.cashierShift.deleteMany({});
    console.log('   ✅ Done\n');

    console.log('🗑️  Deleting CashierPins (except admin)...');
    const adminUser = await prisma.user.findUnique({
      where: { email: 'admin@pos.com' }
    });

    if (adminUser) {
      await prisma.cashierPin.deleteMany({
        where: {
          userId: {
            not: adminUser.id
          }
        }
      });
    } else {
      await prisma.cashierPin.deleteMany({});
    }
    console.log('   ✅ Done\n');

    // PHASE 7: Delete Audit and System data
    console.log('📦 PHASE 7: Cleaning System Data...\n');

    console.log('🗑️  Deleting AuditLogs...');
    await prisma.auditLog.deleteMany({});
    console.log('   ✅ Done\n');

    console.log('🗑️  Deleting UserSessions (except admin)...');
    if (adminUser) {
      await prisma.userSession.deleteMany({
        where: {
          userId: {
            not: adminUser.id
          }
        }
      });
    } else {
      await prisma.userSession.deleteMany({});
    }
    console.log('   ✅ Done\n');

    console.log('🗑️  Deleting Branches...');
    await prisma.branch.deleteMany({});
    console.log('   ✅ Done\n');

    // PHASE 8: Delete Users (keep admin)
    console.log('📦 PHASE 8: Cleaning User Data...\n');

    console.log('🗑️  Deleting ManagerPermissions...');
    await prisma.managerPermission.deleteMany({});
    console.log('   ✅ Done\n');

    console.log('🗑️  Deleting CashierPermissions...');
    await prisma.cashierPermission.deleteMany({});
    console.log('   ✅ Done\n');

    console.log('🗑️  Deleting Users (except admin@pos.com)...');
    const deletedUsers = await prisma.user.deleteMany({
      where: {
        email: {
          not: 'admin@pos.com'
        }
      }
    });
    console.log(`   ✅ Deleted ${deletedUsers.count} users\n`);

    // Final verification
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Database cleanup completed successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Verify admin user
    const verifyAdmin = await prisma.user.findUnique({
      where: { email: 'admin@pos.com' },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true
      }
    });

    if (verifyAdmin) {
      console.log('👤 Admin User Preserved:');
      console.log(`   Email: ${verifyAdmin.email}`);
      console.log(`   Name: ${verifyAdmin.fullName}`);
      console.log(`   Role: ${verifyAdmin.role}`);
      console.log(`   ID: ${verifyAdmin.id}\n`);
    } else {
      console.log('⚠️  WARNING: Admin user not found!\n');
    }

    // Count remaining records
    const counts = {
      users: await prisma.user.count(),
      products: await prisma.product.count(),
      orders: await prisma.order.count(),
      customers: await prisma.customer.count(),
      suppliers: await prisma.supplier.count(),
      categories: await prisma.category.count(),
    };

    console.log('📊 Database Summary:');
    console.log(`   Users: ${counts.users}`);
    console.log(`   Products: ${counts.products}`);
    console.log(`   Orders: ${counts.orders}`);
    console.log(`   Customers: ${counts.customers}`);
    console.log(`   Suppliers: ${counts.suppliers}`);
    console.log(`   Categories: ${counts.categories}\n`);

    console.log('🎯 Database is now clean and ready for fresh data!\n');

  } catch (error) {
    console.error('\n❌ Error during cleanup:', error.message);
    console.error('\nFull error:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the cleanup
cleanupDatabase()
  .then(() => {
    console.log('👋 Cleanup script finished successfully. Exiting...');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Fatal error during cleanup');
    process.exit(1);
  });
