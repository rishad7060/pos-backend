const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Fix missing CustomerCredit transactions for orders with paymentMethod='credit'
 *
 * OLD SYSTEM ISSUE:
 * - Orders were created with paymentMethod='credit'
 * - amountPaid was set to order.total (WRONG!)
 * - NO CustomerCredit transaction was created
 *
 * THIS SCRIPT:
 * - Finds all orders with paymentMethod='credit' that have no credit transactions
 * - Creates the missing credit_added transaction
 * - Fixes the amountPaid field (should be 0 if fully on credit)
 */
async function fixMissingCreditTransactions() {
  console.log('🔍 Finding orders with paymentMethod=credit...\n');

  // Get all orders with paymentMethod='credit'
  const creditOrders = await prisma.order.findMany({
    where: {
      paymentMethod: 'credit',
      customerId: { not: null }
    },
    include: {
      customer: {
        select: { id: true, name: true }
      },
      orderItems: {
        include: {
          product: { select: { name: true } }
        }
      }
    },
    orderBy: { createdAt: 'asc' }
  });

  console.log(`Found ${creditOrders.length} orders with paymentMethod='credit'\n`);

  let fixedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const order of creditOrders) {
    try {
      // Check if CustomerCredit transactions exist for this order
      const existingTransactions = await prisma.customerCredit.findMany({
        where: { orderId: order.id }
      });

      if (existingTransactions.length > 0) {
        console.log(`⏭️  Skip: ${order.orderNumber} - Already has ${existingTransactions.length} credit transaction(s)`);
        skippedCount++;
        continue;
      }

      // This order is missing credit transaction!
      console.log(`\n🔧 Fixing: ${order.orderNumber}`);
      console.log(`   Customer: ${order.customer?.name || 'Unknown'}`);
      console.log(`   Total: LKR ${Number(order.total)}`);
      console.log(`   Amount Paid: LKR ${order.amountPaid ? Number(order.amountPaid) : 0}`);
      console.log(`   Credit Used: LKR ${order.creditUsed ? Number(order.creditUsed) : 0}`);

      // Calculate the unpaid amount (what should have been added to credit)
      const orderTotal = Number(order.total);
      const amountPaid = order.amountPaid ? Number(order.amountPaid) : 0;
      const creditUsed = order.creditUsed ? Number(order.creditUsed) : 0;

      // For pure credit orders (no payment, no old credit used)
      // The entire order total should be added as credit
      const unpaidAmount = orderTotal - creditUsed;

      if (unpaidAmount <= 0) {
        console.log(`   ⚠️  Warning: Nothing to add to credit (unpaid = ${unpaidAmount})`);
        skippedCount++;
        continue;
      }

      // Get customer's current balance BEFORE this transaction
      const previousTransactions = await prisma.customerCredit.findMany({
        where: {
          customerId: order.customerId,
          createdAt: { lt: order.createdAt }
        },
        orderBy: { createdAt: 'asc' }
      });

      // Calculate previous balance
      let previousBalance = 0;
      for (const tx of previousTransactions) {
        const amount = Number(tx.amount);
        const type = tx.transactionType;

        if (type === 'admin_adjustment' || type === 'credit_added' || type === 'credit_refunded' || type === 'sale') {
          previousBalance += amount;
        } else if (type === 'credit_used' || type === 'payment') {
          previousBalance -= amount;
        }
      }

      const newBalance = previousBalance + unpaidAmount;

      console.log(`   Previous Balance: LKR ${previousBalance.toFixed(2)}`);
      console.log(`   Adding Credit: LKR ${unpaidAmount.toFixed(2)}`);
      console.log(`   New Balance: LKR ${newBalance.toFixed(2)}`);

      // Create the missing credit_added transaction
      const creditTransaction = await prisma.customerCredit.create({
        data: {
          customerId: order.customerId,
          orderId: order.id,
          transactionType: 'credit_added',
          amount: unpaidAmount,
          balance: newBalance,
          description: `Unpaid amount for Order #${order.orderNumber} (auto-fixed)`,
          userId: order.cashierId,
          createdAt: order.createdAt, // Use same timestamp as order
        }
      });

      // Fix the order's amountPaid field if needed
      if (amountPaid !== creditUsed) {
        await prisma.order.update({
          where: { id: order.id },
          data: {
            amountPaid: creditUsed, // Only old credit used counts as "paid"
          }
        });
        console.log(`   ✅ Fixed amountPaid: ${amountPaid} → ${creditUsed}`);
      }

      console.log(`   ✅ Created credit_added transaction (ID: ${creditTransaction.id})`);
      fixedCount++;

    } catch (error) {
      console.error(`   ❌ Error fixing ${order.orderNumber}:`, error.message);
      errorCount++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('Summary:');
  console.log('='.repeat(60));
  console.log(`✅ Fixed: ${fixedCount} orders`);
  console.log(`⏭️  Skipped: ${skippedCount} orders (already have transactions)`);
  console.log(`❌ Errors: ${errorCount} orders`);
  console.log('='.repeat(60));

  if (fixedCount > 0) {
    console.log('\n⚠️  IMPORTANT: Run sync-credit-balances script to update Customer.creditBalance');
    console.log('   npm run sync:credits\n');
  }
}

// Run the fix
fixMissingCreditTransactions()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
