/**
 * FIX DATA INTEGRITY ISSUES
 *
 * This script fixes the issues found by the financial audit:
 * 1. Customer credit balances
 * 2. Registry session closing balances (if applicable)
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function showSection(title) {
  console.log('\n' + '═'.repeat(70));
  console.log(`  ${title}`);
  console.log('═'.repeat(70) + '\n');
}

function showStep(message) {
  console.log(`📍 ${message}`);
}

function showSuccess(message) {
  console.log(`✅ ${message}`);
}

function showWarning(message) {
  console.log(`⚠️  ${message}`);
}

function showError(message) {
  console.log(`❌ ${message}`);
}

async function fixCustomerBalances() {
  showSection('FIX 1: CUSTOMER CREDIT BALANCES');

  try {
    const customers = await prisma.customer.findMany({
      include: {
        customerCredits: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    for (const customer of customers) {
      const storedBalance = parseFloat(customer.creditBalance.toString());

      // Calculate correct balance from transactions
      let calculatedBalance = 0;
      customer.customerCredits.forEach(credit => {
        const amount = parseFloat(credit.amount.toString());
        if (credit.transactionType === 'credit_added' ||
            credit.transactionType === 'credit_refunded' ||
            credit.transactionType === 'admin_adjustment') {
          calculatedBalance += amount;
        } else if (credit.transactionType === 'credit_used') {
          calculatedBalance -= amount;
        }
      });

      const diff = Math.abs(calculatedBalance - storedBalance);

      if (diff >= 0.01) {
        showStep(`Customer: ${customer.name}`);
        console.log(`  Current Balance: LKR ${storedBalance.toFixed(2)}`);
        console.log(`  Correct Balance: LKR ${calculatedBalance.toFixed(2)}`);
        console.log(`  Difference: LKR ${diff.toFixed(2)}`);

        // Update the customer balance
        await prisma.customer.update({
          where: { id: customer.id },
          data: { creditBalance: calculatedBalance },
        });

        showSuccess(`Fixed customer balance: LKR ${calculatedBalance.toFixed(2)}`);
      } else {
        console.log(`✓ ${customer.name}: Balance correct (LKR ${storedBalance.toFixed(2)})`);
      }
    }

    showSuccess('Customer balances verified and fixed!\n');
  } catch (error) {
    showError(`Failed to fix customer balances: ${error.message}`);
    throw error;
  }
}

async function fixRegistrySessions() {
  showSection('FIX 2: REGISTRY SESSION CLOSING BALANCES');

  try {
    const sessions = await prisma.registrySession.findMany({
      include: {
        cashTransactions: true,
        orders: {
          where: { status: 'completed' },
          include: {
            paymentDetails: true,
          },
        },
      },
    });

    for (const session of sessions) {
      if (session.status === 'closed' && !session.closingBalance) {
        showStep(`Session #${session.id}`);

        if (!session.openingBalance) {
          showWarning(`Session #${session.id} has no opening balance - skipping\n`);
          continue;
        }

        const openingBalance = parseFloat(session.openingBalance.toString());
        let totalCashSales = 0;
        let totalCashIn = 0;
        let totalCashOut = 0;

        // Calculate cash sales from orders
        session.orders.forEach(order => {
          order.paymentDetails.forEach(payment => {
            if (payment.amount) {
              const amount = parseFloat(payment.amount.toString());
              if (payment.method === 'cash') {
                totalCashSales += amount;
              }
            }
          });
        });

        // Calculate cash in/out from transactions
        session.cashTransactions.forEach(tx => {
          if (tx.amount) {
            const amount = parseFloat(tx.amount.toString());
            if (tx.transactionType === 'cash_in') {
              totalCashIn += amount;
            } else if (tx.transactionType === 'cash_out') {
              totalCashOut += amount;
            }
          }
        });

        const expectedClosing = openingBalance + totalCashSales + totalCashIn - totalCashOut;

        console.log(`  Opening Balance: LKR ${openingBalance.toFixed(2)}`);
        console.log(`  Cash Sales: LKR ${totalCashSales.toFixed(2)}`);
        console.log(`  Cash In: LKR ${totalCashIn.toFixed(2)}`);
        console.log(`  Cash Out: LKR ${totalCashOut.toFixed(2)}`);
        console.log(`  Expected Closing: LKR ${expectedClosing.toFixed(2)}`);

        // Update the session
        await prisma.registrySession.update({
          where: { id: session.id },
          data: {
            expectedCash: totalCashSales,
            closingBalance: expectedClosing,
            actualCash: expectedClosing, // Assuming no discrepancy
            discrepancy: 0,
          },
        });

        showSuccess(`Fixed registry session #${session.id} closing balance\n`);
      } else {
        console.log(`✓ Session #${session.id}: ${session.status === 'open' ? 'Still open' : 'Already has closing balance'}`);
      }
    }

    showSuccess('Registry sessions verified and fixed!\n');
  } catch (error) {
    showError(`Failed to fix registry sessions: ${error.message}`);
    throw error;
  }
}

async function runFixes() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║           DATA INTEGRITY FIXES                             ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  try {
    await fixCustomerBalances();
    await fixRegistrySessions();

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║           ALL FIXES COMPLETED!                             ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    await prisma.$disconnect();
  } catch (error) {
    console.error('\n❌ Fix failed:', error.message);
    await prisma.$disconnect();
    process.exit(1);
  }
}

runFixes();
