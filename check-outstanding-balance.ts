import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkOutstandingBalance() {
  console.log('\n=== CHECKING OUTSTANDING BALANCE ===\n');

  // Get all suppliers with outstanding balance
  const suppliers = await prisma.supplier.findMany({
    where: {
      outstandingBalance: { not: 0 },
    },
    orderBy: { name: 'asc' },
  });

  for (const supplier of suppliers) {
    console.log(`\n📊 Supplier: ${supplier.name} (ID: ${supplier.id})`);
    console.log(`   Database outstandingBalance: ${Number(supplier.outstandingBalance)} LKR`);

    // Calculate outstanding from supplier credits
    const credits = await prisma.supplierCredit.findMany({
      where: { supplierId: supplier.id },
      orderBy: { createdAt: 'asc' },
    });

    let calculatedOutstanding = 0;
    console.log(`\n   📜 Credit Transactions:`);

    for (const credit of credits) {
      const amount = Number(credit.amount);
      const paidAmount = Number(credit.paidAmount || 0);
      const remaining = amount - paidAmount;

      calculatedOutstanding += remaining;

      console.log(`   - ${credit.transactionType}: ${amount} LKR (Paid: ${paidAmount}, Remaining: ${remaining})`);
      console.log(`     Description: ${credit.description}`);
      console.log(`     Status: ${credit.paymentStatus || 'N/A'}`);
    }

    console.log(`\n   ✅ Calculated Outstanding: ${calculatedOutstanding} LKR`);
    console.log(`   📊 Database Outstanding: ${Number(supplier.outstandingBalance)} LKR`);

    if (Math.abs(calculatedOutstanding - Number(supplier.outstandingBalance)) > 0.01) {
      console.log(`   ⚠️  MISMATCH! Difference: ${Math.abs(calculatedOutstanding - Number(supplier.outstandingBalance))} LKR`);
    } else {
      console.log(`   ✓ Values match!`);
    }

    // Check purchases
    const purchases = await prisma.purchase.findMany({
      where: { supplierId: supplier.id },
      orderBy: { createdAt: 'desc' },
    });

    console.log(`\n   📦 Purchase Orders (${purchases.length}):`);
    for (const po of purchases) {
      const total = Number(po.total);
      const paid = Number(po.paidAmount);
      const due = total - paid;

      console.log(`   - ${po.purchaseNumber}: Total ${total}, Paid ${paid}, Due ${due} (Status: ${po.paymentStatus})`);
    }
  }

  await prisma.$disconnect();
}

checkOutstandingBalance();
