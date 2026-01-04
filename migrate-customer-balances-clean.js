/**
 * Clean Customer Balance Migration
 * Extracts ONLY final outstanding balances from old POS system
 * Creates single admin_adjustment record per customer
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function extractCustomerBalances() {
  console.log('\n📊 Extracting customer balances from old SQL export...\n');

  try {
    const sqlFile = path.join(__dirname, '../pos_exports/pos_db_full_with_schema.sql');
    const sqlContent = fs.readFileSync(sqlFile, 'utf8');

    // Extract ALL customer_credits INSERT statements
    const creditRegex = /INSERT INTO public\.customer_credits[^;]+;/gi;
    const creditInserts = sqlContent.match(creditRegex);

    if (!creditInserts) {
      console.log('   ⚠️  No customer_credits found in SQL export');
      return {};
    }

    console.log(`   Found ${creditInserts.length} customer_credit records in SQL export`);

    // Parse each record to extract customerId, balance, and createdAt
    const customerBalances = {};

    creditInserts.forEach(insert => {
      // Extract VALUES clause
      const valuesMatch = insert.match(/VALUES\s*\(([^)]+)\)/i);
      if (!valuesMatch) return;

      const values = valuesMatch[1].split(',').map(v => v.trim().replace(/^'|'$/g, ''));

      // Parse fields: id, customerId, orderId, transactionType, amount, balance, description, userId, createdAt
      const customerId = parseInt(values[1]);
      const balance = parseFloat(values[5]);
      const createdAt = values[8].replace(/'/g, '');

      if (isNaN(customerId) || isNaN(balance)) return;

      // Keep only the latest balance for each customer
      if (!customerBalances[customerId] || new Date(createdAt) > new Date(customerBalances[customerId].createdAt)) {
        customerBalances[customerId] = {
          customerId,
          balance,
          createdAt
        };
      }
    });

    console.log(`   Extracted balances for ${Object.keys(customerBalances).length} customers\n`);
    return customerBalances;

  } catch (error) {
    console.error('   ❌ Error extracting balances:', error.message);
    throw error;
  }
}

async function cleanAndMigrateBalances() {
  console.log('\n💰 Clean Customer Balance Migration Started\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  try {
    // Step 1: Extract balances from old SQL
    const oldBalances = await extractCustomerBalances();

    // Step 2: Get admin user for creating adjustments
    const adminUser = await prisma.user.findFirst({
      where: { role: 'admin' }
    });

    if (!adminUser) {
      console.log('   ⚠️  Admin user not found');
      return;
    }

    // Step 3: Clean existing customer_credits
    console.log('\n🧹 Cleaning existing customer credit records...');
    await prisma.customerCredit.deleteMany({});
    console.log('   ✅ Cleaned\n');

    // Step 4: Create admin_adjustment for each customer with balance
    console.log('📝 Creating admin adjustment records...\n');

    let created = 0;
    let totalBalance = 0;

    for (const [customerId, data] of Object.entries(oldBalances)) {
      try {
        // Check if customer exists in current database
        const customer = await prisma.customer.findUnique({
          where: { id: parseInt(customerId) }
        });

        if (!customer) {
          console.log(`   ⚠️  Skipping customer ID ${customerId} (not found in database)`);
          continue;
        }

        // Only create if balance > 0
        if (data.balance > 0) {
          await prisma.customerCredit.create({
            data: {
              customerId: parseInt(customerId),
              transactionType: 'admin_adjustment',
              amount: data.balance,
              balance: data.balance,
              description: 'Initial outstanding balance - migrated from old POS system',
              userId: adminUser.id,
              createdAt: new Date(data.createdAt)
            }
          });

          // Update customer.creditBalance
          await prisma.customer.update({
            where: { id: parseInt(customerId) },
            data: { creditBalance: data.balance }
          });

          created++;
          totalBalance += data.balance;
          console.log(`   ✅ ${customer.name}: LKR ${data.balance.toFixed(2)}`);
        }
      } catch (error) {
        console.log(`   ⚠️  Error processing customer ${customerId}:`, error.message);
      }
    }

    console.log(`\n   ✅ Created ${created} admin adjustment records`);
    console.log(`   💰 Total outstanding: LKR ${totalBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n`);

    // Step 5: Summary
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 Summary:');

    const customersWithBalance = await prisma.customer.count({
      where: { creditBalance: { gt: 0 } }
    });

    const totalOutstanding = await prisma.customer.aggregate({
      _sum: { creditBalance: true }
    });

    console.log(`   Customers with outstanding balance: ${customersWithBalance}`);
    console.log(`   Total outstanding from customers: LKR ${parseFloat(totalOutstanding._sum.creditBalance || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
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
    console.log('✅ Clean customer balance migration completed!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Fatal error:', error);
    process.exit(1);
  });
