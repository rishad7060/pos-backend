const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkRasaOrders() {
  console.log('Checking recent orders for customer: rasa (ID: 6)\n');

  const orders = await prisma.order.findMany({
    where: { customerId: 6 },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      id: true,
      orderNumber: true,
      total: true,
      amountPaid: true,
      creditUsed: true,
      paymentMethod: true,
      createdAt: true,
    }
  });

  if (orders.length === 0) {
    console.log('No orders found for rasa');
  } else {
    console.log(`Found ${orders.length} recent orders:\n`);
    orders.forEach((order, i) => {
      console.log(`${i + 1}. Order: ${order.orderNumber}`);
      console.log(`   Total: LKR ${Number(order.total).toFixed(2)}`);
      console.log(`   Amount Paid: LKR ${order.amountPaid ? Number(order.amountPaid).toFixed(2) : '0.00'}`);
      console.log(`   Credit Used: LKR ${order.creditUsed ? Number(order.creditUsed).toFixed(2) : '0.00'}`);
      console.log(`   Payment Method: ${order.paymentMethod}`);
      console.log(`   Created: ${order.createdAt.toLocaleString()}`);
      console.log('');
    });
  }

  await prisma.$disconnect();
}

checkRasaOrders().catch(console.error);
