import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixPOOverpayment() {
  console.log('\n=== FIXING PO OVERPAYMENT ISSUE ===\n');

  // Find PO-20251231-4325
  const po = await prisma.purchase.findFirst({
    where: { purchaseNumber: 'PO-20251231-4325' },
  });

  if (!po) {
    console.log('❌ PO not found');
    await prisma.$disconnect();
    return;
  }

  console.log(`📦 Found PO: ${po.purchaseNumber}`);
  console.log(`   Total: ${Number(po.total)} LKR`);
  console.log(`   Current Paid Amount: ${Number(po.paidAmount)} LKR (WRONG!)`);
  console.log(`   Payment Status: ${po.paymentStatus}\n`);

  // Get actual payments from purchasePayment table
  const directPayments = await prisma.purchasePayment.findMany({
    where: { purchaseId: po.id },
  });

  const totalDirectPayments = directPayments.reduce((sum, p) => {
    return sum + Number(p.amount);
  }, 0);

  console.log(`💰 Direct Payments from purchasePayment table:`);
  console.log(`   Count: ${directPayments.length}`);
  console.log(`   Total: ${totalDirectPayments} LKR\n`);

  directPayments.forEach((p, idx) => {
    console.log(`   ${idx + 1}. ${Number(p.amount)} LKR via ${p.paymentMethod} on ${p.paymentDate}`);
  });

  // Get FIFO allocations
  const linkedCredit = await prisma.supplierCredit.findFirst({
    where: { purchaseId: po.id },
  });

  let totalFifoPayments = 0;
  if (linkedCredit) {
    const allocations = await prisma.supplierPaymentAllocation.findMany({
      where: { allocatedCreditId: linkedCredit.id },
    });

    totalFifoPayments = allocations.reduce((sum, a) => {
      return sum + Number(a.allocatedAmount);
    }, 0);

    console.log(`\n📊 FIFO Allocations:`);
    console.log(`   Count: ${allocations.length}`);
    console.log(`   Total: ${totalFifoPayments} LKR\n`);
  }

  // Calculate correct paid amount
  const correctPaidAmount = totalDirectPayments + totalFifoPayments;
  const total = Number(po.total);
  const correctStatus = correctPaidAmount >= total ? 'paid' : correctPaidAmount > 0 ? 'partial' : 'unpaid';

  console.log(`✅ Correct Values:`);
  console.log(`   Total Paid: ${correctPaidAmount} LKR (${totalDirectPayments} direct + ${totalFifoPayments} FIFO)`);
  console.log(`   Status: ${correctStatus}\n`);

  // Update PO
  await prisma.purchase.update({
    where: { id: po.id },
    data: {
      paidAmount: correctPaidAmount,
      paymentStatus: correctStatus,
    },
  });

  console.log(`🔧 Updated PO successfully!\n`);

  // Update linked credit if exists
  if (linkedCredit) {
    const creditAmount = Number(linkedCredit.amount);
    const correctCreditPaid = correctPaidAmount;
    const creditStatus = correctCreditPaid >= creditAmount ? 'paid' : correctCreditPaid > 0 ? 'partial' : 'unpaid';

    await prisma.supplierCredit.update({
      where: { id: linkedCredit.id },
      data: {
        paidAmount: correctCreditPaid,
        paymentStatus: creditStatus,
      },
    });

    console.log(`📝 Updated linked credit:`);
    console.log(`   Credit Amount: ${creditAmount} LKR`);
    console.log(`   Paid Amount: ${correctCreditPaid} LKR`);
    console.log(`   Status: ${creditStatus}\n`);

    // Recalculate supplier outstanding
    const allCredits = await prisma.supplierCredit.findMany({
      where: {
        supplierId: po.supplierId,
        transactionType: { in: ['admin_credit', 'credit'] },
      },
      select: {
        amount: true,
        paidAmount: true,
      },
    });

    let correctOutstanding = 0;
    for (const credit of allCredits) {
      const amt = Number(credit.amount);
      const paid = Number(credit.paidAmount || 0);
      correctOutstanding += (amt - paid);
    }

    await prisma.supplier.update({
      where: { id: po.supplierId },
      data: { outstandingBalance: correctOutstanding },
    });

    console.log(`🏢 Updated supplier outstanding balance: ${correctOutstanding} LKR\n`);
  }

  console.log('✅ All fixes complete!\n');

  await prisma.$disconnect();
}

fixPOOverpayment();
