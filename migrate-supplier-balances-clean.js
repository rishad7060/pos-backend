/**
 * Clean Supplier Balance Migration
 * Extracts ONLY final outstanding balances from old POS system
 * Creates single admin_adjustment record per supplier
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function extractSupplierBalances() {
  console.log('\n📊 Extracting supplier balances from old SQL export...\n');

  try {
    const sqlFile = path.join(__dirname, '../pos_exports/pos_db_full_with_schema.sql');
    const sqlContent = fs.readFileSync(sqlFile, 'utf8');

    const supplierBalances = {};

    // Step 1: Extract supplier_credits for existing balances
    const creditRegex = /INSERT INTO public\.supplier_credits[^;]+;/gi;
    const creditInserts = sqlContent.match(creditRegex);

    if (creditInserts) {
      console.log(`   Found ${creditInserts.length} supplier_credit records`);

      creditInserts.forEach(insert => {
        const valuesMatch = insert.match(/VALUES\s*\(([^)]+)\)/i);
        if (!valuesMatch) return;

        const values = valuesMatch[1].split(',').map(v => v.trim().replace(/^'|'$/g, ''));
        const supplierId = parseInt(values[1]);
        const balance = parseFloat(values[5]);
        const createdAt = values[8].replace(/'/g, '');

        if (isNaN(supplierId) || isNaN(balance)) return;

        if (!supplierBalances[supplierId] || new Date(createdAt) > new Date(supplierBalances[supplierId].createdAt)) {
          supplierBalances[supplierId] = {
            supplierId,
            balance,
            createdAt
          };
        }
      });
    }

    // Step 2: Extract unpaid purchase orders and add to outstanding balances
    const purchaseRegex = /INSERT INTO public\.purchases[^;]+;/gi;
    const purchaseInserts = sqlContent.match(purchaseRegex);

    if (purchaseInserts) {
      console.log(`   Found ${purchaseInserts.length} purchase order records`);

      purchaseInserts.forEach(insert => {
        const valuesMatch = insert.match(/VALUES\s*\(([^)]+)\)/i);
        if (!valuesMatch) return;

        const values = valuesMatch[1].split(',').map(v => v.trim().replace(/^'|'$/g, ''));

        // Parse: id, purchaseNumber, supplierId, branchId, userId, status, subtotal, taxAmount, shippingCost, total, paidAmount, paymentStatus...
        const supplierId = parseInt(values[2]);
        const total = parseFloat(values[9]);
        const paidAmount = parseFloat(values[10]);
        const paymentStatus = values[11].replace(/'/g, '');

        if (isNaN(supplierId) || isNaN(total) || isNaN(paidAmount)) return;

        // Add outstanding amount from unpaid POs
        const outstandingFromPO = total - paidAmount;

        if (outstandingFromPO > 0) {
          if (!supplierBalances[supplierId]) {
            supplierBalances[supplierId] = {
              supplierId,
              balance: 0,
              createdAt: new Date().toISOString()
            };
          }

          supplierBalances[supplierId].balance += outstandingFromPO;
        }
      });
    }

    console.log(`   Calculated balances for ${Object.keys(supplierBalances).length} suppliers\n`);
    return supplierBalances;

  } catch (error) {
    console.error('   ❌ Error extracting balances:', error.message);
    throw error;
  }
}

async function cleanAndMigrateBalances() {
  console.log('\n💰 Clean Supplier Balance Migration Started\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  try {
    // Step 1: Extract balances from old SQL
    const oldBalances = await extractSupplierBalances();

    // Step 2: Get admin user for creating adjustments
    const adminUser = await prisma.user.findFirst({
      where: { role: 'admin' }
    });

    if (!adminUser) {
      console.log('   ⚠️  Admin user not found');
      return;
    }

    // Step 3: Clean existing purchase orders and supplier_credits
    console.log('\n🧹 Cleaning existing purchase orders and supplier credit records...');
    await prisma.purchaseReceive.deleteMany({});
    await prisma.purchaseItem.deleteMany({});
    await prisma.purchasePayment.deleteMany({});
    await prisma.purchase.deleteMany({});
    await prisma.supplierPaymentAllocation.deleteMany({});
    await prisma.supplierCredit.deleteMany({});
    console.log('   ✅ Cleaned\n');

    // Step 4: Create admin_adjustment for each supplier with balance
    console.log('📝 Creating admin adjustment records...\n');

    let created = 0;
    let totalBalance = 0;

    for (const [supplierId, data] of Object.entries(oldBalances)) {
      try {
        // Check if supplier exists in current database
        const supplier = await prisma.supplier.findUnique({
          where: { id: parseInt(supplierId) }
        });

        if (!supplier) {
          console.log(`   ⚠️  Skipping supplier ID ${supplierId} (not found in database)`);
          continue;
        }

        // Only create if balance > 0
        if (data.balance > 0) {
          await prisma.supplierCredit.create({
            data: {
              supplierId: parseInt(supplierId),
              transactionType: 'admin_adjustment',
              amount: data.balance,
              balance: data.balance,
              description: 'Initial outstanding balance (old balance + unpaid POs) - migrated from old POS system',
              userId: adminUser.id,
              createdAt: new Date(data.createdAt)
            }
          });

          // Update supplier.outstandingBalance
          await prisma.supplier.update({
            where: { id: parseInt(supplierId) },
            data: { outstandingBalance: data.balance }
          });

          created++;
          totalBalance += data.balance;
          console.log(`   ✅ ${supplier.name}: LKR ${data.balance.toFixed(2)}`);
        }
      } catch (error) {
        console.log(`   ⚠️  Error processing supplier ${supplierId}:`, error.message);
      }
    }

    console.log(`\n   ✅ Created ${created} admin adjustment records`);
    console.log(`   💰 Total outstanding: LKR ${totalBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n`);

    // Step 5: Summary
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 Summary:');

    const suppliersWithBalance = await prisma.supplier.count({
      where: { outstandingBalance: { gt: 0 } }
    });

    const totalOutstanding = await prisma.supplier.aggregate({
      _sum: { outstandingBalance: true }
    });

    console.log(`   Suppliers with outstanding balance: ${suppliersWithBalance}`);
    console.log(`   Total outstanding to suppliers: LKR ${parseFloat(totalOutstanding._sum.outstandingBalance || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error(error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

cleanAndMigrateBalances()
  .then(() => {
    console.log('✅ Clean supplier balance migration completed!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Fatal error:', error);
    process.exit(1);
  });
