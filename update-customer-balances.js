/**
 * Update Customer Balances from Credit Records
 * Syncs customer.creditBalance with the latest balance from customer_credits table
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function updateCustomerBalances() {
  console.log('\n💰 Updating customer outstanding balances...\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  try {
    const customers = await prisma.customer.findMany({
      select: { id: true, name: true }
    });

    console.log(`   Found ${customers.length} customers\n`);

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
        console.log(`   ✅ ${customer.name}: LKR ${parseFloat(latestCredit.balance).toFixed(2)}`);
      }
    }

    console.log(`\n   ✅ Updated ${updated} customer outstanding balances\n`);

    // Show summary
    const totalCredits = await prisma.customerCredit.count();
    const customersWithBalance = await prisma.customer.count({
      where: { creditBalance: { not: 0 } }
    });

    const totalOutstanding = await prisma.customer.aggregate({
      _sum: { creditBalance: true }
    });

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 Summary:');
    console.log(`   Total customer credit records: ${totalCredits}`);
    console.log(`   Customers with outstanding balance: ${customersWithBalance}`);
    console.log(`   Total outstanding from customers: LKR ${parseFloat(totalOutstanding._sum.creditBalance || 0).toFixed(2)}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    return updated;

  } catch (error) {
    console.error('   ❌ Error updating customer balances:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the update
updateCustomerBalances()
  .then(() => {
    console.log('✅ Customer balances updated successfully!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Update failed:', error);
    process.exit(1);
  });
