import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixSupplierBalance() {
  console.log('=== Recalculating Supplier Balance ===\n');

  const supplierId = 3; // RESQ

  // Get all credits in chronological order
  const credits = await prisma.supplierCredit.findMany({
    where: { supplierId },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Found ${credits.length} transactions\n`);

  let runningBalance = 0;

  console.log('Recalculating balances:\n');

  for (const credit of credits) {
    const amount = Number(credit.amount);
    runningBalance += amount;

    console.log(`Transaction ID ${credit.id}:`);
    console.log(`  Type: ${credit.transactionType}`);
    console.log(`  Amount: ${amount > 0 ? '+' : ''}${amount}`);
    console.log(`  Old Balance: ${Number(credit.balance)}`);
    console.log(`  New Balance: ${runningBalance}`);

    // Update the balance
    await prisma.supplierCredit.update({
      where: { id: credit.id },
      data: { balance: runningBalance },
    });

    console.log(`  ✅ Updated\n`);
  }

  console.log(`\n✅ Final Balance: ${runningBalance} LKR\n`);

  // Update supplier's outstanding balance
  await prisma.supplier.update({
    where: { id: supplierId },
    data: { outstandingBalance: runningBalance },
  });

  console.log(`✅ Supplier outstanding balance updated to: ${runningBalance} LKR\n`);

  // Show credits status
  const updatedCredits = await prisma.supplierCredit.findMany({
    where: {
      supplierId,
      transactionType: { in: ['admin_credit', 'credit'] },
    },
  });

  console.log('Unpaid/Partial Credits:\n');
  updatedCredits.forEach((credit) => {
    const amount = Number(credit.amount);
    const paid = Number(credit.paidAmount);
    const remaining = amount - paid;
    console.log(`  ${credit.description}:`);
    console.log(`    Amount: ${amount} LKR`);
    console.log(`    Paid: ${paid} LKR`);
    console.log(`    Remaining: ${remaining} LKR`);
    console.log(`    Status: ${credit.paymentStatus}\n`);
  });

  await prisma.$disconnect();
}

fixSupplierBalance();
