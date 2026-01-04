import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function cleanupOldPayments() {
  console.log('=== Cleanup Old Non-FIFO Payments ===\n');

  // Find debit transactions with NO allocations (old payments)
  const allDebits = await prisma.supplierCredit.findMany({
    where: {
      transactionType: 'debit',
      supplierId: 3, // RESQ supplier
    },
    include: {
      paymentAllocations: true,
    },
    orderBy: {
      createdAt: 'asc',
    },
  });

  console.log(`Total debit transactions for RESQ: ${allDebits.length}\n`);

  const oldPayments = allDebits.filter(
    (debit) => debit.paymentAllocations.length === 0
  );

  console.log(`Old payments (NO FIFO allocations): ${oldPayments.length}\n`);

  if (oldPayments.length === 0) {
    console.log('✅ No old payments to clean up!');
    await prisma.$disconnect();
    return;
  }

  console.log('Payments to delete:\n');
  let totalToRefund = 0;
  oldPayments.forEach((payment) => {
    const amount = Math.abs(Number(payment.amount));
    totalToRefund += amount;
    console.log(`  ID ${payment.id}: -${amount} LKR (${payment.description})`);
    console.log(`    Created: ${payment.createdAt}`);
  });

  console.log(`\nTotal amount to re-record: ${totalToRefund} LKR\n`);

  console.log('⚠️  WARNING: This will DELETE these payment records!');
  console.log('After deletion, you should re-record the payment using the NEW dialog.\n');

  console.log('Deleting old payments...\n');

  for (const payment of oldPayments) {
    await prisma.supplierCredit.delete({
      where: { id: payment.id },
    });
    console.log(`  ✅ Deleted payment ID ${payment.id}`);
  }

  console.log('\n✅ Old payments deleted successfully!');
  console.log('\n📋 NEXT STEPS:');
  console.log('1. Restart frontend server');
  console.log('2. Go to Supplier Management → RESQ → Credit History');
  console.log('3. Click "Add Manual Credit/Debit"');
  console.log('4. Select "Record Payment (We paid supplier)"');
  console.log(`5. Enter amount: ${totalToRefund} LKR`);
  console.log('6. Click "Record Payment (FIFO)"');
  console.log('7. This will properly allocate to PO using FIFO! ✅\n');

  // Recalculate supplier balance
  const latestCredit = await prisma.supplierCredit.findFirst({
    where: { supplierId: 3 },
    orderBy: { createdAt: 'desc' },
  });

  if (latestCredit) {
    const correctBalance = Number(latestCredit.balance);
    await prisma.supplier.update({
      where: { id: 3 },
      data: { outstandingBalance: correctBalance },
    });
    console.log(`✅ Supplier balance updated to: ${correctBalance} LKR\n`);
  }

  await prisma.$disconnect();
}

cleanupOldPayments();
