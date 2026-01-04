import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkArshaq() {
  try {
    // Find arshaq supplier
    const supplier = await prisma.supplier.findFirst({
      where: {
        name: {
          contains: 'arshaq',
          mode: 'insensitive',
        },
      },
    });

    if (!supplier) {
      console.log('❌ Supplier "arshaq" not found in database');
      await prisma.$disconnect();
      return;
    }

    console.log('\n=== ARSHAQ SUPPLIER STATUS ===\n');
    console.log(`Supplier ID: ${supplier.id}`);
    console.log(`Name: ${supplier.name}`);
    console.log(`Outstanding Balance: ${Number(supplier.outstandingBalance)} LKR\n`);

    // Get all credits (chronological order)
    const credits = await prisma.supplierCredit.findMany({
      where: { supplierId: supplier.id },
      orderBy: { createdAt: 'asc' },
    });

    console.log('📜 CREDIT HISTORY (oldest first - FIFO order):\n');
    credits.forEach((credit, idx) => {
      const amount = Number(credit.amount);
      const paid = Number(credit.paidAmount);
      const remaining = amount - paid;

      console.log(`${idx + 1}. Credit ID: ${credit.id}`);
      console.log(`   Type: ${credit.transactionType}`);
      console.log(`   Amount: ${amount} LKR`);
      console.log(`   Paid: ${paid} LKR`);
      console.log(`   Remaining: ${remaining} LKR`);
      console.log(`   Status: ${credit.paymentStatus || 'unpaid'}`);
      console.log(`   Description: ${credit.description}`);
      console.log(`   Created: ${credit.createdAt}`);
      console.log();
    });

    // Get the latest payment (if any)
    const latestPayment = await prisma.supplierCredit.findFirst({
      where: {
        supplierId: supplier.id,
        transactionType: 'debit',
      },
      orderBy: { createdAt: 'desc' },
      include: {
        paymentAllocations: {
          include: {
            allocatedCredit: true,
          },
        },
      },
    });

    if (latestPayment) {
      console.log('\n💰 LATEST PAYMENT:\n');
      console.log(`Payment Amount: ${Number(latestPayment.amount)} LKR`);
      console.log(`Payment Date: ${latestPayment.createdAt}`);
      console.log(`Description: ${latestPayment.description}\n`);

      if (latestPayment.paymentAllocations.length > 0) {
        console.log('✅ FIFO Allocations:');
        latestPayment.paymentAllocations.forEach((alloc, idx) => {
          console.log(`  ${idx + 1}. Allocated ${Number(alloc.allocatedAmount)} LKR to Credit ID ${alloc.allocatedCreditId}`);
          console.log(`     Description: ${alloc.allocatedCredit.description}`);
        });
      } else {
        console.log('❌ NO FIFO ALLOCATIONS - Payment used OLD endpoint!');
      }
    }

    // Get all purchase orders
    const purchases = await prisma.purchase.findMany({
      where: { supplierId: supplier.id },
      orderBy: { createdAt: 'asc' },
    });

    console.log('\n\n📦 PURCHASE ORDERS:\n');
    if (purchases.length === 0) {
      console.log('No purchase orders found');
    } else {
      purchases.forEach((po, idx) => {
        const total = Number(po.total);
        const paid = Number(po.paidAmount);
        const due = total - paid;

        console.log(`${idx + 1}. PO: ${po.purchaseNumber}`);
        console.log(`   Total: ${total} LKR`);
        console.log(`   Paid: ${paid} LKR`);
        console.log(`   Due: ${due} LKR`);
        console.log(`   Status: ${po.paymentStatus}`);
        console.log(`   Created: ${po.createdAt}`);
        console.log();
      });
    }

    // Expected FIFO allocation for 1300 LKR payment
    console.log('\n=== EXPECTED FIFO ALLOCATION ===\n');
    console.log('If you paid 1300 LKR:');
    console.log('  1. Old debt (1000 LKR) - should be FULLY PAID ✅');
    console.log('  2. PO (500 LKR) - should get 300 LKR → Due: 200 LKR ✅');
    console.log();
    console.log('Expected PO Status:');
    console.log('  Paid: 300 LKR');
    console.log('  Due: 200 LKR');
    console.log('  Status: partial');
    console.log();

    await prisma.$disconnect();
  } catch (error) {
    console.error('Error:', error);
    await prisma.$disconnect();
  }
}

checkArshaq();
