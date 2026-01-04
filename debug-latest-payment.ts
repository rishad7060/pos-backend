import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function debugLatestPayment() {
  console.log('=== DEBUG: Latest Payment Issue ===\n');

  // Find the latest payment
  const latestPayment = await prisma.supplierCredit.findFirst({
    where: {
      transactionType: 'debit',
    },
    orderBy: {
      createdAt: 'desc',
    },
    include: {
      paymentAllocations: {
        include: {
          allocatedCredit: {
            include: {
              purchase: true,
            },
          },
        },
      },
    },
  });

  if (!latestPayment) {
    console.log('No payments found');
    await prisma.$disconnect();
    return;
  }

  console.log('📋 Latest Payment:\n');
  console.log(`  ID: ${latestPayment.id}`);
  console.log(`  Amount: ${Number(latestPayment.amount)} LKR`);
  console.log(`  Description: ${latestPayment.description}`);
  console.log(`  Created: ${latestPayment.createdAt}`);
  console.log(`  Supplier ID: ${latestPayment.supplierId}\n`);

  // Check if it has allocations
  console.log(`🔍 Payment Allocations: ${latestPayment.paymentAllocations.length}\n`);

  if (latestPayment.paymentAllocations.length === 0) {
    console.log('❌ NO ALLOCATIONS FOUND!');
    console.log('This payment was made with the OLD endpoint (not FIFO)\n');
    console.log('The dialog is still calling: POST /api/supplier-credits');
    console.log('It should call: POST /api/supplier-credits/payment\n');
    console.log('🔧 Fix: Check if frontend code was actually updated and server restarted.\n');
  } else {
    console.log('✅ Payment has FIFO allocations:\n');
    latestPayment.paymentAllocations.forEach((alloc, idx) => {
      console.log(`  Allocation ${idx + 1}:`);
      console.log(`    To Credit ID: ${alloc.allocatedCreditId}`);
      console.log(`    Amount Allocated: ${Number(alloc.allocatedAmount)} LKR`);
      console.log(`    Credit Description: ${alloc.allocatedCredit.description}`);
      console.log(`    Credit Type: ${alloc.allocatedCredit.transactionType}`);

      if (alloc.allocatedCredit.purchaseId) {
        console.log(`    Linked to PO ID: ${alloc.allocatedCredit.purchaseId}`);

        if (alloc.allocatedCredit.purchase) {
          const po = alloc.allocatedCredit.purchase;
          console.log(`    PO Number: ${po.purchaseNumber}`);
          console.log(`    PO Total: ${Number(po.total)} LKR`);
          console.log(`    PO Paid: ${Number(po.paidAmount)} LKR`);
          console.log(`    PO Status: ${po.paymentStatus}`);
        }
      } else {
        console.log(`    Not linked to PO (manual credit)`);
      }
      console.log();
    });
  }

  // Check the specific PO mentioned by user
  const po = await prisma.purchase.findFirst({
    where: {
      purchaseNumber: 'PO-20251230-0023',
    },
    include: {
      supplierCredit: true,
    },
  });

  if (po) {
    console.log('\n📦 PO-20251230-0023 Status:\n');
    console.log(`  Total: ${Number(po.total)} LKR`);
    console.log(`  Paid Amount: ${Number(po.paidAmount)} LKR`);
    console.log(`  Due: ${Number(po.total) - Number(po.paidAmount)} LKR`);
    console.log(`  Payment Status: ${po.paymentStatus}\n`);

    if (po.supplierCredit) {
      console.log(`  Linked Credit ID: ${po.supplierCredit.id}`);
      console.log(`  Credit Amount: ${Number(po.supplierCredit.amount)} LKR`);
      console.log(`  Credit Paid Amount: ${Number(po.supplierCredit.paidAmount)} LKR`);
      console.log(`  Credit Status: ${po.supplierCredit.paymentStatus}\n`);

      // Check if this credit has allocations
      const creditAllocations = await prisma.supplierPaymentAllocation.findMany({
        where: {
          allocatedCreditId: po.supplierCredit.id,
        },
      });

      console.log(`  Allocations to this PO's credit: ${creditAllocations.length}`);

      if (creditAllocations.length === 0) {
        console.log('  ❌ NO ALLOCATIONS - Payment not using FIFO!\n');
      } else {
        creditAllocations.forEach((alloc, idx) => {
          console.log(`    ${idx + 1}. Allocated: ${Number(alloc.allocatedAmount)} LKR`);
        });
      }
    }
  }

  // Check which endpoint is being called by looking at payment descriptions
  console.log('\n🔍 Checking Payment Endpoint Usage:\n');

  const recentPayments = await prisma.supplierCredit.findMany({
    where: {
      transactionType: 'debit',
      createdAt: {
        gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
    include: {
      paymentAllocations: true,
    },
  });

  console.log(`Found ${recentPayments.length} payments in last 24 hours:\n`);

  recentPayments.forEach((payment, idx) => {
    const hasAllocations = payment.paymentAllocations.length > 0;
    const endpoint = hasAllocations ? 'POST /api/supplier-credits/payment (FIFO ✅)' : 'POST /api/supplier-credits (OLD ❌)';

    console.log(`${idx + 1}. ${Number(payment.amount)} LKR - ${payment.description}`);
    console.log(`   Endpoint: ${endpoint}`);
    console.log(`   Allocations: ${payment.paymentAllocations.length}`);
    console.log(`   Created: ${payment.createdAt}\n`);
  });

  await prisma.$disconnect();
}

debugLatestPayment();
