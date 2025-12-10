// Quick test to check permissions
const { PrismaClient } = require('@prisma/client');

async function quickTest() {
  const prisma = new PrismaClient();

  try {
    console.log('=== QUICK PERMISSION TEST ===');

    // Check all permissions
    const permissions = await prisma.cashierPermission.findMany({
      include: { cashier: true }
    });

    console.log(`Found ${permissions.length} permission records:`);
    permissions.forEach(p => {
      console.log(`- Cashier: ${p.cashier?.fullName} (ID: ${p.cashierId})`);
      console.log(`  canEditPrices: ${p.canEditPrices} (${typeof p.canEditPrices})`);
      console.log(`  canApplyDiscount: ${p.canApplyDiscount} (${typeof p.canApplyDiscount})`);
      console.log(`  canProcessRefunds: ${p.canProcessRefunds} (${typeof p.canProcessRefunds})`);
    });

    // Check cashiers
    const cashiers = await prisma.user.findMany({
      where: { role: 'cashier' }
    });

    console.log(`\nFound ${cashiers.length} cashiers:`);
    cashiers.forEach(c => {
      console.log(`- ID: ${c.id}, Name: ${c.fullName}`);
    });

  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

quickTest();
