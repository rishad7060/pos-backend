const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testPermissions() {
  try {
    console.log('=== TESTING PERMISSION API SIMULATION ===');

    // Simulate API call for cashierId = 2
    const cashierId = 2;
    console.log(`\nTesting permissions for cashierId: ${cashierId}`);

    const permission = await prisma.cashierPermission.findUnique({
      where: { cashierId: parseInt(cashierId) },
    });

    console.log('Raw permission from DB:', permission);

    if (permission) {
      // Simulate what the backend returns
      const serialized = {
        ...permission,
        maxDiscountPercent: permission.maxDiscountPercent ? Number(permission.maxDiscountPercent.toString()) : 0,
      };
      console.log('Serialized response (what backend returns):', serialized);
      console.log('canEditPrices value:', serialized.canEditPrices, typeof serialized.canEditPrices);
    } else {
      console.log('No permissions found for this cashier');
    }

    console.log('\n=== ALL CASHIER PERMISSIONS ===');
    const allPermissions = await prisma.cashierPermission.findMany({
      include: { cashier: true }
    });
    allPermissions.forEach(p => {
      console.log(`Cashier: ${p.cashier?.fullName} (${p.cashierId}) - canEditPrices: ${p.canEditPrices}`);
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testPermissions();
