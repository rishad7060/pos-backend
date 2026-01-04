const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkSupplierBalances() {
  const suppliers = await prisma.supplier.findMany({
    orderBy: { name: 'asc' },
    include: {
      supplierCredits: {
        orderBy: { createdAt: 'desc' },
        take: 1
      }
    }
  });

  console.log(`Total suppliers: ${suppliers.length}\n`);
  console.log('Suppliers with outstanding balances:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  suppliers.forEach(s => {
    const balance = parseFloat(s.outstandingBalance);
    const latestCredit = s.supplierCredits[0]?.balance.toString() || 'No credits';

    if (balance > 0 || s.supplierCredits.length > 0) {
      console.log(`${s.name}:`);
      console.log(`  outstandingBalance: LKR ${balance.toFixed(2)}`);
      console.log(`  Latest credit: ${latestCredit}`);
      console.log('');
    }
  });

  const total = await prisma.supplier.aggregate({
    _sum: { outstandingBalance: true }
  });

  const count = await prisma.supplier.count({
    where: { outstandingBalance: { gt: 0 } }
  });

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Suppliers with balance: ${count}`);
  console.log(`Total outstanding: LKR ${parseFloat(total._sum.outstandingBalance || 0).toFixed(2)}`);

  await prisma.$disconnect();
}

checkSupplierBalances();
