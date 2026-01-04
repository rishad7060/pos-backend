import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixOutstandingBalances() {
  console.log('\n=== FIXING SUPPLIER OUTSTANDING BALANCES ===\n');

  // Get all suppliers
  const suppliers = await prisma.supplier.findMany({
    orderBy: { name: 'asc' },
  });

  for (const supplier of suppliers) {
    console.log(`\n📊 Processing: ${supplier.name} (ID: ${supplier.id})`);
    console.log(`   Current database outstanding: ${Number(supplier.outstandingBalance)} LKR`);

    // Get all credit transactions for this supplier
    const credits = await prisma.supplierCredit.findMany({
      where: {
        supplierId: supplier.id,
        transactionType: { in: ['admin_credit', 'credit'] },
      },
      select: {
        id: true,
        amount: true,
        paidAmount: true,
        description: true,
        transactionType: true,
      },
    });

    // Calculate actual outstanding: sum of (amount - paidAmount)
    let correctOutstanding = 0;
    for (const credit of credits) {
      const amount = Number(credit.amount);
      const paid = Number(credit.paidAmount || 0);
      const remaining = amount - paid;
      correctOutstanding += remaining;

      if (remaining > 0) {
        console.log(`   - ${credit.transactionType}: ${amount} LKR (Paid: ${paid}, Remaining: ${remaining})`);
      }
    }

    console.log(`\n   ✅ Correct outstanding: ${correctOutstanding} LKR`);

    if (Math.abs(correctOutstanding - Number(supplier.outstandingBalance)) > 0.01) {
      console.log(`   🔧 Updating database from ${Number(supplier.outstandingBalance)} to ${correctOutstanding}`);

      await prisma.supplier.update({
        where: { id: supplier.id },
        data: { outstandingBalance: correctOutstanding },
      });

      console.log(`   ✅ Updated successfully!`);
    } else {
      console.log(`   ✓ Already correct, no update needed`);
    }
  }

  console.log('\n=== FIX COMPLETE ===\n');

  await prisma.$disconnect();
}

fixOutstandingBalances();
