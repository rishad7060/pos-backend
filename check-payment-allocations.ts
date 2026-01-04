import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkPaymentAllocations() {
  console.log('=== Checking Payment Allocations ===\n');

  // Check if there are any payment allocation records
  const allocations = await prisma.supplierPaymentAllocation.findMany({
    include: {
      paymentCredit: true,
      allocatedCredit: true,
    },
  });

  console.log(`Total Payment Allocations: ${allocations.length}\n`);

  if (allocations.length === 0) {
    console.log('❌ NO PAYMENT ALLOCATIONS FOUND!');
    console.log('This means payments were made using the OLD endpoint (simple debit)');
    console.log('They did NOT use the FIFO allocation system.\n');
  } else {
    console.log('✅ Payment allocations exist:\n');
    allocations.forEach((alloc, idx) => {
      console.log(`Allocation ${idx + 1}:`);
      console.log(`  Payment Credit ID: ${alloc.paymentCreditId}`);
      console.log(`  Allocated To Credit ID: ${alloc.allocatedCreditId}`);
      console.log(`  Amount Allocated: ${Number(alloc.allocatedAmount)}`);
      console.log(`  Payment Description: ${alloc.paymentCredit.description}`);
      console.log(`  Credit Description: ${alloc.allocatedCredit.description}`);
      console.log();
    });
  }

  // Check recent debit transactions (payments)
  const recentPayments = await prisma.supplierCredit.findMany({
    where: {
      transactionType: 'debit',
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: 5,
  });

  console.log('\n=== Recent Payment Transactions ===\n');
  recentPayments.forEach((payment) => {
    console.log(`Payment ID: ${payment.id}`);
    console.log(`  Amount: ${Number(payment.amount)}`);
    console.log(`  Description: ${payment.description}`);
    console.log(`  Created: ${payment.createdAt}`);
    console.log(`  Supplier ID: ${payment.supplierId}`);
    console.log();
  });

  // Check if PO has any payment allocations
  const po = await prisma.purchase.findFirst({
    where: { purchaseNumber: 'PO-20251230-5584' },
    select: {
      id: true,
      purchaseNumber: true,
      total: true,
      paidAmount: true,
      paymentStatus: true,
    },
  });

  if (po) {
    console.log('\n=== PO Payment Info ===\n');
    console.log(`PO: ${po.purchaseNumber}`);
    console.log(`Total: ${Number(po.total)}`);
    console.log(`Paid Amount: ${Number(po.paidAmount)}`);
    console.log(`Payment Status: ${po.paymentStatus}`);

    // Check if this PO has a linked credit
    const poCredit = await prisma.supplierCredit.findFirst({
      where: { purchaseId: po.id },
    });

    if (poCredit) {
      console.log(`\nLinked Credit ID: ${poCredit.id}`);
      console.log(`Credit Amount: ${Number(poCredit.amount)}`);
      console.log(`Credit Paid Amount: ${Number(poCredit.paidAmount)}`);
      console.log(`Credit Payment Status: ${poCredit.paymentStatus}`);

      // Check if this credit has any allocations
      const creditAllocations = await prisma.supplierPaymentAllocation.findMany({
        where: { allocatedCreditId: poCredit.id },
      });

      console.log(`\nAllocations to this PO's credit: ${creditAllocations.length}`);
      if (creditAllocations.length === 0) {
        console.log('❌ NO ALLOCATIONS - Payments were made with OLD endpoint!');
      }
    }
  }

  await prisma.$disconnect();
}

checkPaymentAllocations();
