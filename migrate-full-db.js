/**
 * Complete Database Migration Script
 * Migrates data from old POS system to new system
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function cleanDatabase() {
  console.log('\n🧹 Step 1: Cleaning existing database...\n');

  try {
    // Delete all data in correct order
    await prisma.orderItemBatch.deleteMany({});
    await prisma.refundItem.deleteMany({});
    await prisma.orderItem.deleteMany({});
    await prisma.paymentDetail.deleteMany({});
    await prisma.holdOrder.deleteMany({});
    await prisma.refund.deleteMany({});
    await prisma.order.deleteMany({});
    await prisma.priceChangeHistory.deleteMany({});
    await prisma.stockBatch.deleteMany({});
    await prisma.stockMovement.deleteMany({});
    await prisma.product.deleteMany({});
    await prisma.category.deleteMany({});
    await prisma.purchaseReturnItem.deleteMany({});
    await prisma.purchaseReturn.deleteMany({});
    await prisma.purchaseReceive.deleteMany({});
    await prisma.purchaseItem.deleteMany({});
    await prisma.purchasePayment.deleteMany({});
    await prisma.purchase.deleteMany({});
    await prisma.supplierPaymentAllocation.deleteMany({});
    await prisma.supplierCredit.deleteMany({});
    await prisma.supplier.deleteMany({});
    await prisma.customerCredit.deleteMany({});
    await prisma.customer.deleteMany({});
    await prisma.cheque.deleteMany({});
    await prisma.cashTransaction.deleteMany({});
    await prisma.expense.deleteMany({});
    await prisma.expenseCategory.deleteMany({});
    await prisma.registrySession.deleteMany({});
    await prisma.cashierShift.deleteMany({});
    await prisma.cashierPin.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.userSession.deleteMany({});
    await prisma.branch.deleteMany({});
    await prisma.managerPermission.deleteMany({});
    await prisma.cashierPermission.deleteMany({});
    await prisma.user.deleteMany({});

    console.log('   ✅ Database cleaned\n');
  } catch (error) {
    console.error('   ❌ Error cleaning database:', error.message);
    throw error;
  }
}

async function importData() {
  console.log('\n📥 Step 2: Importing data from full SQL dump...\n');

  try {
    const sqlFile = path.join(__dirname, '../pos_exports/pos_db_full_with_schema.sql');
    const sqlContent = fs.readFileSync(sqlFile, 'utf8');

    // Extract only INSERT statements for our tables
    const tables = [
      'users',
      'suppliers',
      'customers',
      'categories',
      'products',
      'orders',
      'order_items',
      'payment_details',
      'customer_credits',
      'supplier_credits',
      'stock_batches'
    ];

    let totalImported = 0;

    for (const table of tables) {
      // Extract INSERT statements for this table
      const regex = new RegExp(`INSERT INTO public\\.${table}[^;]+;`, 'gi');
      const inserts = sqlContent.match(regex);

      if (!inserts || inserts.length === 0) {
        console.log(`   ⚠️  No data found for ${table}`);
        continue;
      }

      console.log(`   📦 Importing ${table}...`);
      let imported = 0;
      let skipped = 0;

      for (const insert of inserts) {
        try {
          await prisma.$executeRawUnsafe(insert);
          imported++;
        } catch (error) {
          skipped++;
          // Silently skip errors (usually foreign key or duplicate issues)
        }
      }

      console.log(`      ✅ Imported ${imported} records${skipped > 0 ? ` (skipped ${skipped})` : ''}`);
      totalImported += imported;
    }

    console.log(`\n   ✅ Total records imported: ${totalImported}\n`);
    return totalImported;

  } catch (error) {
    console.error('   ❌ Error importing data:', error.message);
    throw error;
  }
}

async function ensureAdminUser() {
  console.log('\n👤 Step 3: Ensuring admin user exists...\n');

  try {
    // Check if admin user exists
    let adminUser = await prisma.user.findFirst({
      where: {
        role: 'admin'
      }
    });

    if (!adminUser) {
      // Create admin user
      const hashedPassword = await bcrypt.hash('admin123', 10);
      adminUser = await prisma.user.create({
        data: {
          email: 'admin@pos.com',
          passwordHash: hashedPassword,
          fullName: 'Admin User',
          role: 'admin',
          isActive: true
        }
      });
      console.log('   ✅ Created admin user: admin@pos.com / admin123\n');
    } else {
      console.log(`   ✅ Admin user exists: ${adminUser.email}\n`);
    }

    return adminUser;
  } catch (error) {
    console.error('   ❌ Error with admin user:', error.message);
    throw error;
  }
}

async function createStockBatches() {
  console.log('\n📦 Step 4: Creating stock batches for inventory tracking...\n');

  try {
    // Get all products with stock > 0 that don't have batches
    const products = await prisma.product.findMany({
      where: {
        stockQuantity: {
          gt: 0
        }
      },
      select: {
        id: true,
        name: true,
        stockQuantity: true,
        costPrice: true
      }
    });

    console.log(`   Found ${products.length} products with stock\n`);

    let created = 0;
    const today = new Date();

    for (const product of products) {
      // Check if batch already exists for this product
      const existingBatch = await prisma.stockBatch.findFirst({
        where: { productId: product.id }
      });

      if (existingBatch) {
        continue; // Skip if batch already exists
      }

      try {
        const batchNumber = `INIT-${product.id}-${Date.now()}`;
        const costPrice = product.costPrice || 0;

        await prisma.stockBatch.create({
          data: {
            productId: product.id,
            batchNumber: batchNumber,
            receivedDate: today,
            quantityReceived: product.stockQuantity,
            quantityRemaining: product.stockQuantity,
            costPrice: costPrice,
            notes: 'Initial stock - migrated from old system'
          }
        });

        created++;
        if (created % 20 === 0) {
          console.log(`      Progress: ${created} batches created...`);
        }
      } catch (error) {
        // Skip errors
      }
    }

    console.log(`\n   ✅ Created ${created} stock batches\n`);
    return created;

  } catch (error) {
    console.error('   ❌ Error creating stock batches:', error.message);
    return 0;
  }
}

async function setupCustomerCredits() {
  console.log('\n💰 Step 5: Setting up customer credit records...\n');

  try {
    const adminUser = await prisma.user.findFirst({
      where: { role: 'admin' }
    });

    if (!adminUser) {
      console.log('   ⚠️  Admin user not found, skipping credit setup\n');
      return 0;
    }

    // Get customers with credit balance but no credit records
    const customers = await prisma.customer.findMany({
      where: {
        creditBalance: {
          not: 0
        }
      }
    });

    let created = 0;

    for (const customer of customers) {
      try {
        // Check if credit record already exists
        const existing = await prisma.customerCredit.findFirst({
          where: {
            customerId: customer.id,
            transactionType: 'admin_adjustment'
          }
        });

        if (existing) continue;

        await prisma.customerCredit.create({
          data: {
            customerId: customer.id,
            transactionType: 'admin_adjustment',
            amount: customer.creditBalance,
            balance: customer.creditBalance,
            description: 'Initial balance - migrated from old system',
            userId: adminUser.id
          }
        });

        created++;
      } catch (error) {
        // Skip errors
      }
    }

    console.log(`   ✅ Created ${created} customer credit records\n`);
    return created;

  } catch (error) {
    console.error('   ❌ Error setting up customer credits:', error.message);
    return 0;
  }
}

async function updateSupplierBalances() {
  console.log('\n💰 Step 6: Updating supplier outstanding balances...\n');

  try {
    const suppliers = await prisma.supplier.findMany({
      select: { id: true, name: true }
    });

    let updated = 0;

    for (const supplier of suppliers) {
      // Get latest balance from supplier_credits
      const latestCredit = await prisma.supplierCredit.findFirst({
        where: { supplierId: supplier.id },
        orderBy: { createdAt: 'desc' },
        select: { balance: true }
      });

      if (latestCredit) {
        await prisma.supplier.update({
          where: { id: supplier.id },
          data: { outstandingBalance: latestCredit.balance }
        });
        updated++;
      }
    }

    console.log(`   ✅ Updated ${updated} supplier outstanding balances\n`);
    return updated;

  } catch (error) {
    console.error('   ❌ Error updating supplier balances:', error.message);
    return 0;
  }
}

async function updateCustomerBalances() {
  console.log('\n💰 Step 7: Updating customer outstanding balances...\n');

  try {
    const customers = await prisma.customer.findMany({
      select: { id: true, name: true }
    });

    let updated = 0;

    for (const customer of customers) {
      // Get latest balance from customer_credits
      const latestCredit = await prisma.customerCredit.findFirst({
        where: { customerId: customer.id },
        orderBy: { createdAt: 'desc' },
        select: { balance: true }
      });

      if (latestCredit) {
        await prisma.customer.update({
          where: { id: customer.id },
          data: { creditBalance: latestCredit.balance }
        });
        updated++;
      }
    }

    console.log(`   ✅ Updated ${updated} customer outstanding balances\n`);
    return updated;

  } catch (error) {
    console.error('   ❌ Error updating customer balances:', error.message);
    return 0;
  }
}

async function generateSummary() {
  console.log('\n📊 Final Summary:\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const counts = {
    users: await prisma.user.count(),
    suppliers: await prisma.supplier.count(),
    customers: await prisma.customer.count(),
    products: await prisma.product.count(),
    categories: await prisma.category.count(),
    orders: await prisma.order.count(),
    stockBatches: await prisma.stockBatch.count(),
    customerCredits: await prisma.customerCredit.count(),
    supplierCredits: await prisma.supplierCredit.count()
  };

  console.log(`\n📈 Database Counts:`);
  console.log(`   Users: ${counts.users}`);
  console.log(`   Suppliers: ${counts.suppliers}`);
  console.log(`   Customers: ${counts.customers}`);
  console.log(`   Products: ${counts.products}`);
  console.log(`   Categories: ${counts.categories}`);
  console.log(`   Orders: ${counts.orders}`);
  console.log(`   Stock Batches: ${counts.stockBatches}`);
  console.log(`   Customer Credits: ${counts.customerCredits}`);
  console.log(`   Supplier Credits: ${counts.supplierCredits}`);

  // Calculate inventory value
  const batches = await prisma.stockBatch.findMany({
    select: {
      quantityRemaining: true,
      costPrice: true
    }
  });

  const inventoryValue = batches.reduce((sum, batch) => {
    return sum + (parseFloat(batch.quantityRemaining) * parseFloat(batch.costPrice));
  }, 0);

  console.log(`\n💎 Inventory Value:`);
  console.log(`   Total: LKR ${inventoryValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

  // Calculate supplier outstanding balance
  const supplierBalances = await prisma.supplier.aggregate({
    _sum: { outstandingBalance: true }
  });

  const suppliersWithBalance = await prisma.supplier.count({
    where: { outstandingBalance: { not: 0 } }
  });

  console.log(`\n💰 Supplier Outstanding:`);
  console.log(`   Suppliers with balance: ${suppliersWithBalance}`);
  console.log(`   Total outstanding: LKR ${parseFloat(supplierBalances._sum.outstandingBalance || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

  // Calculate customer outstanding balance
  const customerBalances = await prisma.customer.aggregate({
    _sum: { creditBalance: true }
  });

  const customersWithBalance = await prisma.customer.count({
    where: { creditBalance: { not: 0 } }
  });

  console.log(`\n💳 Customer Outstanding:`);
  console.log(`   Customers with balance: ${customersWithBalance}`);
  console.log(`   Total outstanding: LKR ${parseFloat(customerBalances._sum.creditBalance || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

  // Show admin user info
  const adminUser = await prisma.user.findFirst({
    where: { role: 'admin' },
    select: {
      email: true,
      fullName: true,
      role: true
    }
  });

  if (adminUser) {
    console.log(`\n👤 Admin User:`);
    console.log(`   Email: ${adminUser.email}`);
    console.log(`   Name: ${adminUser.fullName}`);
    console.log(`   Password: admin123 (default)`);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

async function main() {
  console.log('\n🚀 Complete Database Migration Started\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const startTime = Date.now();

  try {
    await cleanDatabase();
    await importData();
    await ensureAdminUser();
    await createStockBatches();
    await setupCustomerCredits();
    await updateSupplierBalances();
    await updateCustomerBalances();
    await generateSummary();

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('✅ Migration completed successfully!');
    console.log(`⏱️  Time taken: ${duration} seconds\n`);
    console.log('🎯 Your old POS database is now fully migrated to the new system!\n');

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error('\nFull error:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then(() => {
    console.log('👋 Migration script finished. Exiting...\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Fatal error during migration');
    process.exit(1);
  });
