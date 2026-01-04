import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixDuplicatePayments() {
  console.log('\n=== FIXING DUPLICATE PAYMENTS ===\n');

  // Find PO-20251230-2102
  const po = await prisma.purchase.findFirst({
    where: { purchaseNumber: 'PO-20251230-2102' },
    include: {
      purchasePayments: true,
    },
  });

  if (!po) {
    console.log('PO-20251230-2102 not found');
    await prisma.$disconnect();
    return;
  }

  console.log(`Found PO: ${po.purchaseNumber}`);
  console.log(`  Total: ${Number(po.total)} LKR`);
  console.log(`  Current Paid Amount: ${Number(po.paidAmount)} LKR`);
  console.log(`  Payment Status: ${po.paymentStatus}`);
  console.log(`  Direct payments: ${po.purchasePayments.length}\n`);

  if (po.purchasePayments.length > 0) {
    console.log('🗑️  Deleting duplicate direct payments...');

    await prisma.purchasePayment.deleteMany({
      where: { purchaseId: po.id },
    });

    console.log(`   Deleted ${po.purchasePayments.length} payment record(s)\n`);
  }

  // Get FIFO allocation amount
  const supplierCredit = await prisma.supplierCredit.findFirst({
    where: { purchaseId: po.id },
  });

  if (supplierCredit) {
    const allocations = await prisma.supplierPaymentAllocation.findMany({
      where: { allocatedCreditId: supplierCredit.id },
    });

    const totalFifoPayment = allocations.reduce((sum, alloc) => {
      return sum + Number(alloc.allocatedAmount);
    }, 0);

    console.log('💰 FIFO Allocation:');
    console.log(`   Total allocated: ${totalFifoPayment} LKR`);
    console.log(`   Number of allocations: ${allocations.length}\n`);

    // Recalculate correct paidAmount
    const correctPaidAmount = totalFifoPayment;
    const total = Number(po.total);
    const correctStatus = correctPaidAmount >= total ? 'paid' : correctPaidAmount > 0 ? 'partial' : 'unpaid';

    console.log('✅ Updating PO with correct values:');
    console.log(`   Setting paidAmount to: ${correctPaidAmount} LKR`);
    console.log(`   Setting paymentStatus to: ${correctStatus}\n`);

    await prisma.purchase.update({
      where: { id: po.id },
      data: {
        paidAmount: correctPaidAmount,
        paymentStatus: correctStatus,
      },
    });

    console.log('✅ Fixed successfully!\n');
    console.log('Updated values:');
    console.log(`   Total: ${total} LKR`);
    console.log(`   Paid: ${correctPaidAmount} LKR`);
    console.log(`   Due: ${total - correctPaidAmount} LKR`);
    console.log(`   Status: ${correctStatus}`);
  } else {
    console.log('❌ No FIFO allocation found for this PO');
  }

  await prisma.$disconnect();
}

fixDuplicatePayments();
