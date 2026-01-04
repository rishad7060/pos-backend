import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkPOPayment() {
  // Check the PO from the screenshot
  const po = await prisma.purchase.findFirst({
    where: { purchaseNumber: 'PO-20251230-5584' },
    select: {
      id: true,
      purchaseNumber: true,
      total: true,
      paidAmount: true,
      paymentStatus: true,
      supplierId: true,
      status: true,
    },
  });

  console.log('=== PO Payment Status ===\n');
  if (po) {
    console.log('Purchase Order:', po.purchaseNumber);
    console.log('Total:', Number(po.total));
    console.log('Paid Amount:', Number(po.paidAmount));
    console.log('Due Amount:', Number(po.total) - Number(po.paidAmount));
    console.log('Payment Status:', po.paymentStatus);
    console.log('PO Status:', po.status);
    console.log('Supplier ID:', po.supplierId);
  } else {
    console.log('PO not found');
  }

  // Check if there are any payment allocations for this PO
  const allocations = await prisma.supplierPaymentAllocation.findMany({
    where: {
      allocatedCredit: {
        purchaseId: po?.id,
      },
    },
    include: {
      paymentCredit: true,
      allocatedCredit: true,
    },
  });

  console.log('\n=== Payment Allocations for this PO ===');
  if (allocations.length > 0) {
    allocations.forEach((alloc, idx) => {
      console.log(`\nAllocation ${idx + 1}:`);
      console.log('  Allocated Amount:', Number(alloc.allocatedAmount));
      console.log('  Payment Date:', alloc.paymentCredit.createdAt);
      console.log('  Credit Amount:', Number(alloc.allocatedCredit.amount));
      console.log('  Credit Paid Amount:', Number(alloc.allocatedCredit.paidAmount));
      console.log('  Credit Payment Status:', alloc.allocatedCredit.paymentStatus);
    });
  } else {
    console.log('No payment allocations found for this PO');
  }

  // Check supplier credit for this PO
  const poCredit = await prisma.supplierCredit.findFirst({
    where: { purchaseId: po?.id },
  });

  console.log('\n=== Supplier Credit for this PO ===');
  if (poCredit) {
    console.log('Credit ID:', poCredit.id);
    console.log('Amount:', Number(poCredit.amount));
    console.log('Paid Amount:', Number(poCredit.paidAmount));
    console.log('Remaining:', Number(poCredit.amount) - Number(poCredit.paidAmount));
    console.log('Payment Status:', poCredit.paymentStatus);
  } else {
    console.log('No supplier credit found for this PO');
  }

  await prisma.$disconnect();
}

checkPOPayment();
