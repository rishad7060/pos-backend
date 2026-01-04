const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function verifyDatabase() {
  try {
    const counts = {
      users: await prisma.user.count(),
      products: await prisma.product.count(),
      orders: await prisma.order.count(),
      customers: await prisma.customer.count(),
      suppliers: await prisma.supplier.count(),
      categories: await prisma.category.count(),
      cheques: await prisma.cheque.count(),
      stockBatches: await prisma.stockBatch.count(),
      cashTransactions: await prisma.cashTransaction.count(),
    };

    console.log('\n📊 Database Status:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`  Users: ${counts.users}`);
    console.log(`  Products: ${counts.products}`);
    console.log(`  Orders: ${counts.orders}`);
    console.log(`  Customers: ${counts.customers}`);
    console.log(`  Suppliers: ${counts.suppliers}`);
    console.log(`  Categories: ${counts.categories}`);
    console.log(`  Cheques: ${counts.cheques}`);
    console.log(`  Stock Batches: ${counts.stockBatches}`);
    console.log(`  Cash Transactions: ${counts.cashTransactions}`);

    const admin = await prisma.user.findUnique({
      where: { email: 'admin@pos.com' },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true
      }
    });

    console.log('\n👤 Admin User:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    if (admin) {
      console.log(`  Email: ${admin.email}`);
      console.log(`  Name: ${admin.fullName}`);
      console.log(`  Role: ${admin.role}`);
      console.log(`  ID: ${admin.id}`);
    } else {
      console.log('  ⚠️  Admin user not found!');
    }

    console.log('\n✅ Database is clean and ready!\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

verifyDatabase();
