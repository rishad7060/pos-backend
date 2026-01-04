const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function investigate() {
  try {
    console.log('\n📋 INVESTIGATING BATCH ALLOCATION ISSUE\n');
    console.log('='.repeat(70));

    const orderItems = await prisma.orderItem.findMany({
      include: {
        orderItemBatches: true,
        order: { select: { orderNumber: true } },
      },
      take: 10,
    });

    console.log(`Order Items Found: ${orderItems.length}\n`);

    for (const item of orderItems) {
      console.log(`Order: ${item.order.orderNumber}`);
      console.log(`  Item: ${item.itemName}`);
      console.log(`  Quantity: ${item.netWeightKg} kg`);
      console.log(`  Cost Price: LKR ${item.costPrice}`);
      console.log(`  Batch Allocations: ${item.orderItemBatches.length}`);

      if (item.orderItemBatches.length === 0) {
        console.log('  ❌ NO BATCH ALLOCATIONS FOUND!');
      } else {
        item.orderItemBatches.forEach(batch => {
          console.log(`    - Batch ${batch.stockBatchId}: Qty ${batch.quantity} kg @ LKR ${batch.costPrice}/kg`);
        });
      }
      console.log('');
    }

    console.log('\n\n👥 INVESTIGATING CUSTOMER CREDIT ISSUE\n');
    console.log('='.repeat(70));

    const customers = await prisma.customer.findMany({
      include: {
        customerCredits: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    for (const customer of customers) {
      console.log(`\nCustomer: ${customer.name}`);
      console.log(`  Stored Balance: LKR ${customer.creditBalance}`);
      console.log(`  Transactions: ${customer.customerCredits.length}`);

      if (customer.customerCredits.length > 0) {
        let calculated = 0;
        console.log('  Transaction History:');
        customer.customerCredits.forEach(credit => {
          const amount = parseFloat(credit.amount.toString());
          if (credit.transactionType === 'credit_added' || credit.transactionType === 'admin_adjustment') {
            calculated += amount;
            console.log(`    + ${credit.transactionType}: LKR ${amount} (Running: LKR ${calculated.toFixed(2)})`);
          } else if (credit.transactionType === 'credit_used') {
            calculated -= amount;
            console.log(`    - ${credit.transactionType}: LKR ${amount} (Running: LKR ${calculated.toFixed(2)})`);
          }
        });

        console.log(`  Calculated Balance: LKR ${calculated.toFixed(2)}`);
        const diff = Math.abs(calculated - parseFloat(customer.creditBalance.toString()));
        console.log(`  Difference: LKR ${diff.toFixed(2)} ${diff > 0.01 ? '❌' : '✅'}`);
      }
    }

    console.log('\n\n💵 INVESTIGATING REGISTRY SESSION ISSUE\n');
    console.log('='.repeat(70));

    const sessions = await prisma.registrySession.findMany({
      include: {
        cashTransactions: true,
        registry: { select: { name: true } },
      },
    });

    for (const session of sessions) {
      console.log(`\nSession #${session.id} - ${session.registry.name}`);
      console.log(`  Status: ${session.status}`);
      console.log(`  Opening Balance: LKR ${session.openingBalance}`);
      console.log(`  Closing Balance: ${session.closingBalance ? 'LKR ' + session.closingBalance : 'NULL ❌'}`);
      console.log(`  Expected Sales: LKR ${session.expectedCash || 0}`);
      console.log(`  Cash Transactions: ${session.cashTransactions.length}`);

      if (session.cashTransactions.length > 0) {
        let totalIn = 0;
        let totalOut = 0;
        session.cashTransactions.forEach(tx => {
          const amt = parseFloat(tx.amount.toString());
          if (tx.transactionType === 'cash_in') totalIn += amt;
          if (tx.transactionType === 'cash_out') totalOut += amt;
        });
        console.log(`    Cash In: LKR ${totalIn}`);
        console.log(`    Cash Out: LKR ${totalOut}`);
      }
    }

    await prisma.$disconnect();
  } catch (error) {
    console.error('Investigation error:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

investigate();
