import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function showCurrentState() {
  console.log('=== CURRENT STATE AFTER CLEANUP ===\n');

  // Get supplier
  const supplier = await prisma.supplier.findUnique({
    where: { id: 3 },
  });

  console.log('📊 Supplier: RESQ');
  console.log(`   Outstanding Balance: ${Number(supplier?.outstandingBalance)} LKR\n`);

  // Get all credits
  const credits = await prisma.supplierCredit.findMany({
    where: { supplierId: 3 },
    orderBy: { createdAt: 'asc' },
    include: {
      allocationsReceived: true,
    },
  });

  console.log('📝 Credit Ledger:\n');
  credits.forEach((credit, idx) => {
    const amount = Number(credit.amount);
    const balance = Number(credit.balance);
    const paidAmount = Number(credit.paidAmount);
    const status = credit.paymentStatus || 'N/A';
    const allocCount = credit.allocationsReceived.length;

    console.log(`${idx + 1}. ${credit.transactionType.toUpperCase()}`);
    console.log(`   ID: ${credit.id}`);
    console.log(`   Amount: ${amount > 0 ? '+' : ''}${amount} LKR`);
    console.log(`   Balance: ${balance} LKR`);
    if (credit.transactionType !== 'debit') {
      console.log(`   Paid: ${paidAmount} LKR`);
      console.log(`   Status: ${status}`);
      console.log(`   Allocations Received: ${allocCount}`);
    }
    console.log(`   Description: ${credit.description}`);
    console.log(`   Purchase ID: ${credit.purchaseId || 'None'}`);
    console.log(`   Created: ${credit.createdAt}`);
    console.log();
  });

  // Get PO
  const po = await prisma.purchase.findFirst({
    where: { purchaseNumber: 'PO-20251230-5584' },
  });

  if (po) {
    console.log('📦 Purchase Order: PO-20251230-5584\n');
    console.log(`   Total: ${Number(po.total)} LKR`);
    console.log(`   Paid Amount: ${Number(po.paidAmount)} LKR`);
    console.log(`   Due: ${Number(po.total) - Number(po.paidAmount)} LKR`);
    console.log(`   Payment Status: ${po.paymentStatus}\n`);
  }

  console.log('🎯 NEXT ACTION:\n');
  console.log('You should now see in the frontend:');
  console.log('  - 1 old credit (OLD B/L): 50,000 LKR - PARTIAL (2,000 paid)');
  console.log('  - 1 PO credit (PO-20251230-5584): 25,000 LKR - UNPAID');
  console.log('  - 1 payment: -2,000 LKR (already allocated)\n');
  console.log('To complete the scenario:');
  console.log('  1. Refresh your browser (Ctrl + Shift + R)');
  console.log('  2. Check Credit History - old payments should be gone');
  console.log('  3. Outstanding should show: 73,000 LKR');
  console.log('  4. Record new payment: 73,000 LKR using FIFO dialog');
  console.log('  5. FIFO will pay: OLD B/L (remaining 48,000) + PO (25,000)');
  console.log('  6. PO Due will become: 0 LKR ✅\n');

  await prisma.$disconnect();
}

showCurrentState();
