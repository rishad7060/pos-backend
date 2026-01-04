const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkOrderTransactions() {
  console.log('Checking transactions for order: ORD-20251229-3354\n');

  const order = await prisma.order.findFirst({
    where: { orderNumber: 'ORD-20251229-3354' },
    include: {
      paymentDetails: true,
    }
  });

  if (!order) {
    console.log('Order not found');
    return;
  }

  console.log('Order Details:');
  console.log('==============');
  console.log(`Order Number: ${order.orderNumber}`);
  console.log(`Total: LKR ${Number(order.total).toFixed(2)}`);
  console.log(`Amount Paid: LKR ${order.amountPaid ? Number(order.amountPaid).toFixed(2) : '0.00'}`);
  console.log(`Credit Used: LKR ${order.creditUsed ? Number(order.creditUsed).toFixed(2) : '0.00'}`);
  console.log(`Payment Method: ${order.paymentMethod}`);
  console.log(`Cash Received: LKR ${order.cashReceived ? Number(order.cashReceived).toFixed(2) : 'N/A'}`);

  console.log('\nPayment Records:');
  console.log('================');
  if (order.paymentDetails && order.paymentDetails.length > 0) {
    order.paymentDetails.forEach((p, i) => {
      console.log(`${i + 1}. ${p.paymentType}: LKR ${Number(p.amount).toFixed(2)}`);
    });
  } else {
    console.log('No payment records found');
  }

  // Check CustomerCredit transactions
  const creditTxs = await prisma.customerCredit.findMany({
    where: { orderId: order.id },
    orderBy: { createdAt: 'asc' }
  });

  console.log('\nCustomerCredit Transactions:');
  console.log('============================');
  if (creditTxs.length > 0) {
    creditTxs.forEach((tx, i) => {
      console.log(`${i + 1}. Type: ${tx.transactionType}`);
      console.log(`   Amount: LKR ${Number(tx.amount).toFixed(2)}`);
      console.log(`   Balance (stored): LKR ${Number(tx.balance).toFixed(2)}`);
      console.log(`   Description: ${tx.description}`);
      console.log('');
    });
  } else {
    console.log('No credit transactions found for this order');
  }

  await prisma.$disconnect();
}

checkOrderTransactions().catch(console.error);
