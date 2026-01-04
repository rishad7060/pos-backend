import { PrismaClient } from '@prisma/client';
import { decimalToNumber } from '../utils/decimal';

const prisma = new PrismaClient();

/**
 * Sync customer credit balances from CustomerCredit transactions to Customer.creditBalance
 * RECALCULATES balances from scratch by processing ALL transactions chronologically
 * This fixes incorrect balances from old transaction records
 */
async function syncCreditBalances() {
  try {
    console.log('Starting credit balance synchronization...\n');
    console.log('⚠️  RECALCULATING from transaction history (ignoring old balance values)\n');

    // Get all customers
    const customers = await prisma.customer.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        creditBalance: true
      }
    });

    console.log(`Found ${customers.length} customers to process\n`);

    let updatedCount = 0;
    let skippedCount = 0;
    let issuesFound = 0;

    for (const customer of customers) {
      // Get ALL transactions for this customer in chronological order
      const transactions = await prisma.customerCredit.findMany({
        where: { customerId: customer.id },
        orderBy: { createdAt: 'asc' }
      });

      if (transactions.length === 0) {
        // No credit records, ensure balance is 0
        const currentBalance = decimalToNumber(customer.creditBalance) ?? 0;
        if (currentBalance !== 0) {
          await prisma.customer.update({
            where: { id: customer.id },
            data: { creditBalance: 0 }
          });
          console.log(`✅ Reset customer #${customer.id} (${customer.name}): ${currentBalance} → 0 (no credit records)`);
          updatedCount++;
        } else {
          skippedCount++;
        }
        continue;
      }

      // Calculate correct balance by processing all transactions
      let calculatedBalance = 0;

      for (const transaction of transactions) {
        const amount = Number(transaction.amount);
        const type = transaction.transactionType;

        // Add to balance (customer owes more)
        if (type === 'admin_adjustment' || type === 'credit_added' || type === 'credit_refunded' || type === 'sale') {
          // Note: "sale" is old transaction type for credit purchases (unpaid orders)
          calculatedBalance += amount;
        }
        // Subtract from balance (customer paid)
        else if (type === 'credit_used' || type === 'payment') {
          // Note: "payment" is old transaction type for credit payments
          calculatedBalance -= amount;
        }
      }

      // Ensure balance is not negative
      calculatedBalance = Math.max(0, calculatedBalance);

      const currentBalance = Number(customer.creditBalance);
      const difference = Math.abs(calculatedBalance - currentBalance);

      // Update if different (with 0.01 tolerance for floating point)
      if (difference > 0.01) {
        await prisma.customer.update({
          where: { id: customer.id },
          data: { creditBalance: calculatedBalance }
        });

        if (difference > 100) {
          console.log(`⚠️  MAJOR FIX: Customer #${customer.id} (${customer.name}): ${currentBalance.toFixed(2)} → ${calculatedBalance.toFixed(2)} (diff: ${difference.toFixed(2)})`);
          issuesFound++;
        } else {
          console.log(`✅ Updated customer #${customer.id} (${customer.name}): ${currentBalance.toFixed(2)} → ${calculatedBalance.toFixed(2)}`);
        }
        updatedCount++;
      } else {
        console.log(`⏭️  Skipped customer #${customer.id} (${customer.name}): already correct (${currentBalance.toFixed(2)})`);
        skippedCount++;
      }
    }

    console.log('\n========================================');
    console.log('Credit Balance Synchronization Complete!');
    console.log('========================================');
    console.log(`✅ Updated: ${updatedCount} customers`);
    console.log(`⏭️  Skipped: ${skippedCount} customers (already correct)`);
    console.log(`📊 Total: ${customers.length} customers processed`);
    if (issuesFound > 0) {
      console.log(`⚠️  MAJOR ISSUES FIXED: ${issuesFound} customers had >100 LKR discrepancy`);
    }
    console.log('');

    // Show summary of customers with credit
    const customersWithCredit = await prisma.customer.findMany({
      where: {
        creditBalance: { gt: 0 },
        deletedAt: null
      },
      select: {
        id: true,
        name: true,
        creditBalance: true
      },
      orderBy: { creditBalance: 'desc' }
    });

    if (customersWithCredit.length > 0) {
      console.log('Customers with Credit Balances:');
      console.log('================================');
      customersWithCredit.forEach(c => {
        console.log(`  • ${c.name}: LKR ${Number(c.creditBalance).toFixed(2)}`);
      });
      console.log(`\nTotal: ${customersWithCredit.length} customers with credit\n`);
    } else {
      console.log('ℹ️  No customers currently have credit balances.\n');
    }

  } catch (error) {
    console.error('Error syncing credit balances:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the sync
syncCreditBalances()
  .then(() => {
    console.log('✅ Script completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
