import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function verifyPOStatus() {
  console.log('=== VERIFICATION: Current PO Status ===\n');

  // Get PO from database
  const po = await prisma.purchase.findFirst({
    where: { purchaseNumber: 'PO-20251230-5584' },
  });

  if (!po) {
    console.log('PO not found');
    await prisma.$disconnect();
    return;
  }

  const total = Number(po.total);
  const paid = Number(po.paidAmount);
  const due = total - paid;

  console.log('📦 PO-20251230-5584 (Database Values)\n');
  console.log(`   Total: ${total} LKR`);
  console.log(`   Paid: ${paid} LKR`);
  console.log(`   Due: ${due} LKR`);
  console.log(`   Payment Status: ${po.paymentStatus}\n`);

  if (paid === 0) {
    console.log('❌ FRONTEND IS CORRECT - No payment allocated to PO yet!');
  } else if (paid === total) {
    console.log('✅ PO IS FULLY PAID!');
  } else {
    console.log('⚠️  PO IS PARTIALLY PAID');
    console.log(`   Remaining to pay: ${due} LKR\n`);
  }

  // Get supplier status
  const supplier = await prisma.supplier.findUnique({
    where: { id: po.supplierId },
  });

  console.log('📊 Supplier Outstanding\n');
  console.log(`   Database: ${Number(supplier?.outstandingBalance)} LKR`);
  console.log(`   Frontend should show: ${Number(supplier?.outstandingBalance)} LKR\n`);

  // Get all allocations for this PO
  const poCredit = await prisma.supplierCredit.findFirst({
    where: { purchaseId: po.id },
    include: {
      allocationsReceived: {
        include: {
          paymentCredit: true,
        },
      },
    },
  });

  if (poCredit && poCredit.allocationsReceived.length > 0) {
    console.log('💰 Payment Allocations to this PO:\n');
    poCredit.allocationsReceived.forEach((alloc, idx) => {
      console.log(`   ${idx + 1}. ${Number(alloc.allocatedAmount)} LKR`);
      console.log(`      From payment: ${alloc.paymentCredit.description}`);
      console.log(`      Date: ${alloc.createdAt}\n`);
    });

    const totalAllocated = poCredit.allocationsReceived.reduce(
      (sum, alloc) => sum + Number(alloc.allocatedAmount),
      0
    );
    console.log(`   Total Allocated: ${totalAllocated} LKR`);
    console.log(`   PO Paid Amount: ${paid} LKR`);

    if (totalAllocated === paid) {
      console.log('   ✅ Allocations match PO paid amount!\n');
    } else {
      console.log('   ❌ Mismatch between allocations and PO paid amount!\n');
    }
  } else {
    console.log('❌ No payment allocations found for this PO\n');
  }

  // Check what API would return
  console.log('🔌 What API Returns:\n');
  console.log(`GET /api/purchases/${po.id}\n`);
  console.log(`{`);
  console.log(`  "id": ${po.id},`);
  console.log(`  "purchaseNumber": "${po.purchaseNumber}",`);
  console.log(`  "total": ${total},`);
  console.log(`  "paidAmount": ${paid},`);
  console.log(`  "paymentStatus": "${po.paymentStatus}",`);
  console.log(`  "outstanding": ${due}`);
  console.log(`}\n`);

  console.log('🌐 Frontend Display Issue?\n');
  if (paid > 0) {
    console.log('The database has the correct values (paid amount = ' + paid + ')');
    console.log('If frontend shows 0, it\'s a caching issue.');
    console.log('\nFixes:');
    console.log('1. Hard refresh: Ctrl + Shift + R');
    console.log('2. Navigate away and back');
    console.log('3. Restart frontend server\n');
  } else {
    console.log('The database shows NO payment has been allocated to this PO.');
    console.log('Check payment allocations above.\n');
  }

  await prisma.$disconnect();
}

verifyPOStatus();
