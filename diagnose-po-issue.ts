import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function diagnose() {
  console.log('\n=== DIAGNOSTIC: PO Payment Not Showing ===\n');

  // Find the aaa supplier
  const supplier = await prisma.supplier.findFirst({
    where: { name: 'aaa' },
  });

  if (!supplier) {
    console.log('❌ Supplier "aaa" not found');
    await prisma.$disconnect();
    return;
  }

  console.log('✅ Supplier Found:');
  console.log(`   Name: ${supplier.name}`);
  console.log(`   ID: ${supplier.id}`);
  console.log(`   Outstanding Balance: ${Number(supplier.outstandingBalance)} LKR\n`);

  // Get PO from database
  const po = await prisma.purchase.findFirst({
    where: { supplierId: supplier.id },
    orderBy: { createdAt: 'desc' },
  });

  if (!po) {
    console.log('❌ No PO found for supplier aaa');
    await prisma.$disconnect();
    return;
  }

  console.log('📦 DATABASE VALUES:');
  console.log(`   PO Number: ${po.purchaseNumber}`);
  console.log(`   Total: ${Number(po.total)} LKR`);
  console.log(`   Paid Amount: ${Number(po.paidAmount)} LKR`);
  console.log(`   Due: ${Number(po.total) - Number(po.paidAmount)} LKR`);
  console.log(`   Status: ${po.paymentStatus}\n`);

  // Check payment allocations
  const allocations = await prisma.supplierPaymentAllocation.findMany({
    where: {
      allocatedCredit: {
        purchaseId: po.id,
      },
    },
    include: {
      paymentCredit: true,
      allocatedCredit: true,
    },
  });

  console.log(`\n💰 PAYMENT ALLOCATIONS: ${allocations.length}`);
  if (allocations.length > 0) {
    allocations.forEach((alloc, idx) => {
      console.log(`   ${idx + 1}. Amount: ${Number(alloc.allocatedAmount)} LKR`);
      console.log(`      From Payment: ${alloc.paymentCredit.description}`);
    });
  } else {
    console.log('   ❌ No FIFO allocations found!');
    console.log('   This means the payment used the OLD endpoint.');
  }

  // Get credit history
  const credits = await prisma.supplierCredit.findMany({
    where: { supplierId: supplier.id },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`\n📜 CREDIT HISTORY (${credits.length} entries):`);
  credits.forEach((credit, idx) => {
    const amount = Number(credit.amount);
    const paid = Number(credit.paidAmount);
    console.log(`   ${idx + 1}. ${credit.transactionType}: ${amount} LKR (Paid: ${paid}, Status: ${credit.paymentStatus || 'unpaid'})`);
    console.log(`      ${credit.description}`);
  });

  await prisma.$disconnect();
}

diagnose();
