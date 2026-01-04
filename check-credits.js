const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkCredits() {
  try {
    // Check customer_credits table
    const creditRecords = await prisma.customerCredit.findMany({
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            creditBalance: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 10
    });

    const totalCredits = await prisma.customerCredit.count();

    console.log('\n💳 Customer Credit Records:\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Total credit records: ${totalCredits}`);
    console.log('\nMost recent 10 records:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    creditRecords.forEach(record => {
      console.log(`Customer: ${record.customer.name} (ID: ${record.customerId})`);
      console.log(`  Type: ${record.transactionType}`);
      console.log(`  Amount: LKR ${parseFloat(record.amount).toFixed(2)}`);
      console.log(`  Balance: LKR ${parseFloat(record.balance).toFixed(2)}`);
      console.log(`  Customer Balance: LKR ${parseFloat(record.customer.creditBalance).toFixed(2)}`);
      console.log(`  Description: ${record.description || 'N/A'}`);
      console.log('');
    });

    // Check if any customers have non-zero credit balance
    const customersWithBalance = await prisma.customer.findMany({
      where: {
        creditBalance: {
          not: 0
        }
      },
      select: {
        id: true,
        name: true,
        creditBalance: true
      }
    });

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`\nCustomers with non-zero credit balance: ${customersWithBalance.length}\n`);

    if (customersWithBalance.length > 0) {
      customersWithBalance.slice(0, 5).forEach(c => {
        console.log(`  ${c.name}: LKR ${parseFloat(c.creditBalance).toFixed(2)}`);
      });
    }

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkCredits();
