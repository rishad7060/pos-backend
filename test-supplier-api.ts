import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testSupplierCalculation() {
  console.log('=== Testing Supplier API Calculation Logic ===\n');

  const supplier = await prisma.supplier.findUnique({
    where: { id: 3 }, // RESQ
    include: {
      purchases: {
        include: {
          purchasePayments: true,
        },
      },
      supplierCredits: true,
    },
  });

  if (!supplier) {
    console.log('Supplier not found');
    return;
  }

  console.log(`Supplier: ${supplier.name} (ID: ${supplier.id})`);
  console.log(`Database outstandingBalance field: ${supplier.outstandingBalance}\n`);

  // Replicate the API's calculation logic (lines 44-71 of SuppliersController)
  const totalPurchases = supplier.purchases.reduce((sum, purchase) => {
    const total = Number(purchase.total);
    return sum + (total ?? 0);
  }, 0);

  const totalPaid = supplier.purchases.reduce((sum, purchase) => {
    const paid = purchase.purchasePayments.reduce((paymentSum, payment) => {
      const amount = Number(payment.amount);
      return paymentSum + (amount ?? 0);
    }, 0);
    return sum + paid;
  }, 0);

  const latestCredit = supplier.supplierCredits.length > 0
    ? supplier.supplierCredits.sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )[0]
    : null;

  const manualCreditsBalance = latestCredit ? Number(latestCredit.balance) : 0;

  // This is what the API currently calculates (WRONG)
  const apiCalculatedBalance = totalPurchases - totalPaid + manualCreditsBalance;

  console.log('API Calculation Breakdown:');
  console.log(`  Total Purchases (from Purchase table): ${totalPurchases}`);
  console.log(`  Total Paid (from PurchasePayments): ${totalPaid}`);
  console.log(`  Purchases - Payments: ${totalPurchases - totalPaid}`);
  console.log(`  Latest Credit Balance (from SupplierCredit ledger): ${manualCreditsBalance}`);
  console.log(`  API Formula: (${totalPurchases} - ${totalPaid}) + ${manualCreditsBalance} = ${apiCalculatedBalance}`);
  console.log(`\n  ❌ API Returns: ${apiCalculatedBalance.toFixed(2)}`);
  console.log(`  ✅ Database Has: ${Number(supplier.outstandingBalance).toFixed(2)}`);
  console.log(`  🔍 Difference: ${(apiCalculatedBalance - Number(supplier.outstandingBalance)).toFixed(2)}`);

  console.log('\n=== Why This is Wrong ===');
  console.log('The SupplierCredit ledger already includes BOTH:');
  console.log('  1. Manual credits added by admin');
  console.log('  2. Automatic credits from POs');
  console.log('So the formula is DOUBLE COUNTING the PO amounts!');
  console.log('\n✅ CORRECT: Just use supplier.outstandingBalance from database');

  await prisma.$disconnect();
}

testSupplierCalculation();
