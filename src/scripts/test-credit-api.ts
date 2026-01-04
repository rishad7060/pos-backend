import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Test the credit API endpoints to verify they return correct data
 */
async function testCreditAPI() {
  try {
    console.log('Testing Credit API Endpoints...\n');
    console.log('=====================================\n');

    // Test 1: Get customers with credit
    console.log('Test 1: Get Customers with Credit');
    console.log('----------------------------------');
    const customers = await prisma.customer.findMany({
      where: {
        creditBalance: { gt: 0 },
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        creditBalance: true,
        totalPurchases: true,
        visitCount: true,
        createdAt: true,
      },
      orderBy: {
        creditBalance: 'desc',
      },
    });

    console.log(`Found: ${customers.length} customers with credit balances`);
    if (customers.length > 0) {
      console.log('\nCustomer Details:');
      customers.forEach((c, i) => {
        console.log(`  ${i + 1}. ${c.name}`);
        console.log(`     ID: ${c.id}`);
        console.log(`     Credit Balance: LKR ${Number(c.creditBalance).toFixed(2)}`);
        console.log(`     Phone: ${c.phone || 'N/A'}`);
        console.log(`     Email: ${c.email || 'N/A'}`);
        console.log(`     Total Purchases: LKR ${Number(c.totalPurchases).toFixed(2)}`);
        console.log(`     Visit Count: ${c.visitCount}`);
        console.log('');
      });
    } else {
      console.log('⚠️  No customers have credit balances!\n');
    }

    // Test 2: Get credit summary
    console.log('\nTest 2: Get Credit Summary');
    console.log('---------------------------');

    const allCredits = await prisma.customerCredit.findMany({
      include: {
        customer: {
          select: { name: true },
        },
      },
    });

    const creditsAdded = allCredits.filter(c => c.transactionType === 'credit_added');
    const creditsUsed = allCredits.filter(c => c.transactionType === 'credit_used');

    const totalAdded = creditsAdded.reduce((sum, c) => sum + Number(c.amount), 0);
    const totalUsed = creditsUsed.reduce((sum, c) => sum + Number(c.amount), 0);

    const customersWithCredit = await prisma.customer.findMany({
      where: {
        creditBalance: { gt: 0 },
        deletedAt: null,
      },
    });

    const totalOutstanding = customersWithCredit.reduce((sum, c) => sum + Number(c.creditBalance), 0);

    console.log(`Total Credits Added: LKR ${totalAdded.toFixed(2)} (${creditsAdded.length} transactions)`);
    console.log(`Total Credits Used: LKR ${totalUsed.toFixed(2)} (${creditsUsed.length} transactions)`);
    console.log(`Total Outstanding: LKR ${totalOutstanding.toFixed(2)}`);
    console.log(`Customers with Credit: ${customersWithCredit.length}`);

    // Test 3: Check all customer credit transactions
    console.log('\n\nTest 3: All Credit Transactions');
    console.log('--------------------------------');
    console.log(`Total credit transactions in database: ${allCredits.length}`);

    if (allCredits.length > 0) {
      console.log('\nRecent Transactions:');
      const recent = allCredits.slice(0, 5);
      recent.forEach((t, i) => {
        console.log(`  ${i + 1}. ${t.transactionType} - ${t.customer?.name || 'Unknown'}`);
        console.log(`     Amount: LKR ${Number(t.amount).toFixed(2)}`);
        console.log(`     Balance: LKR ${Number(t.balance).toFixed(2)}`);
        console.log(`     Date: ${t.createdAt.toISOString()}`);
        console.log('');
      });
    }

    // Test 4: Check if Customer.creditBalance matches latest CustomerCredit.balance
    console.log('\nTest 4: Credit Balance Consistency Check');
    console.log('------------------------------------------');

    let consistencyIssues = 0;
    for (const customer of customers) {
      const latestCredit = await prisma.customerCredit.findFirst({
        where: { customerId: customer.id },
        orderBy: { createdAt: 'desc' },
      });

      if (latestCredit) {
        if (Number(customer.creditBalance) !== Number(latestCredit.balance)) {
          console.log(`❌ INCONSISTENCY: Customer #${customer.id} (${customer.name})`);
          console.log(`   Customer.creditBalance: ${customer.creditBalance}`);
          console.log(`   Latest Credit.balance: ${latestCredit.balance}`);
          consistencyIssues++;
        }
      }
    }

    if (consistencyIssues === 0) {
      console.log('✅ All customer credit balances are consistent!');
    } else {
      console.log(`⚠️  Found ${consistencyIssues} consistency issues!`);
      console.log('   Run: npm run sync:credits to fix');
    }

    console.log('\n=====================================');
    console.log('Test Complete!');
    console.log('=====================================\n');

  } catch (error) {
    console.error('Error testing credit API:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
testCreditAPI()
  .then(() => {
    console.log('✅ All tests completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Tests failed:', error);
    process.exit(1);
  });
