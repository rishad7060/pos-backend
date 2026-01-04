const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function verifyBalances() {
  console.log('\n🔍 Verifying Customer and Supplier Balances\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // 1. Customer Balances
  const customers = await prisma.customer.findMany({
    select: {
      id: true,
      name: true,
      creditBalance: true
    }
  });

  const customersWithBalance = customers.filter(c => parseFloat(c.creditBalance) !== 0);
  const totalCustomerBalance = customers.reduce((sum, c) => sum + parseFloat(c.creditBalance), 0);

  console.log('\n👨‍💼 CUSTOMERS:');
  console.log(`   Total customers: ${customers.length}`);
  console.log(`   Customers with non-zero balance: ${customersWithBalance.length}`);
  console.log(`   Total outstanding (from customer table): LKR ${totalCustomerBalance.toFixed(2)}\n`);

  if (customersWithBalance.length > 0) {
    console.log('   Customers with balance:');
    customersWithBalance.forEach(c => {
      console.log(`   - ${c.name}: LKR ${parseFloat(c.creditBalance).toFixed(2)}`);
    });
    console.log('');
  }

  // Check if sum of credit records matches
  const creditSum = await prisma.customerCredit.aggregate({
    _sum: { amount: true }
  });

  console.log(`   Sum of all customer_credits.amount: LKR ${parseFloat(creditSum._sum.amount || 0).toFixed(2)}`);
  console.log('   ⚠️  This should NOT be used for total outstanding!\n');

  // 2. Supplier Balances
  const suppliers = await prisma.supplier.findMany({
    select: {
      id: true,
      name: true,
      outstandingBalance: true
    }
  });

  const suppliersWithBalance = suppliers.filter(s => parseFloat(s.outstandingBalance) !== 0);
  const totalSupplierBalance = suppliers.reduce((sum, s) => sum + parseFloat(s.outstandingBalance), 0);

  console.log('\n🏭 SUPPLIERS:');
  console.log(`   Total suppliers: ${suppliers.length}`);
  console.log(`   Suppliers with non-zero balance: ${suppliersWithBalance.length}`);
  console.log(`   Total outstanding (from supplier table): LKR ${totalSupplierBalance.toFixed(2)}\n`);

  if (suppliersWithBalance.length > 0) {
    console.log('   Suppliers with balance:');
    suppliersWithBalance.forEach(s => {
      console.log(`   - ${s.name}: LKR ${parseFloat(s.outstandingBalance).toFixed(2)}`);
    });
    console.log('');
  }

  // Check if sum of credit records matches
  const supplierCreditSum = await prisma.supplierCredit.aggregate({
    _sum: { amount: true }
  });

  console.log(`   Sum of all supplier_credits.amount: LKR ${parseFloat(supplierCreditSum._sum.amount || 0).toFixed(2)}`);
  console.log('   ⚠️  This should NOT be used for total outstanding!\n');

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\n✅ Correct Calculation:');
  console.log(`   Customer Outstanding: LKR ${totalCustomerBalance.toFixed(2)} (from customer.creditBalance)`);
  console.log(`   Supplier Outstanding: LKR ${totalSupplierBalance.toFixed(2)} (from supplier.outstandingBalance)\n`);

  await prisma.$disconnect();
}

verifyBalances();
