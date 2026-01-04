const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkCustomerBalances() {
  try {
    const customers = await prisma.customer.findMany({
      where: {
        creditBalance: {
          not: 0
        }
      },
      select: {
        id: true,
        name: true,
        creditBalance: true
      },
      orderBy: {
        creditBalance: 'desc'
      }
    });

    console.log('\n💰 Customers with Credit Balances:\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(' ID  | Customer Name                  | Outstanding Balance');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    customers.forEach(c => {
      const id = c.id.toString().padStart(4, ' ');
      const name = c.name.padEnd(30, ' ');
      const balance = parseFloat(c.creditBalance).toFixed(2);
      console.log(` ${id} | ${name} | LKR ${balance}`);
    });

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log(`Total customers with balance: ${customers.length}`);

    const total = customers.reduce((sum, c) => sum + parseFloat(c.creditBalance), 0);
    console.log(`Total outstanding: LKR ${total.toFixed(2)}\n`);

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkCustomerBalances();
