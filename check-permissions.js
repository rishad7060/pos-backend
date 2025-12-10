const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkPermissions() {
  try {
    console.log('=== CASHIER PERMISSIONS ===');
    const permissions = await prisma.cashierPermission.findMany({
      include: { cashier: true }
    });
    permissions.forEach(p => {
      console.log(`Cashier: ${p.cashier?.fullName} (ID: ${p.cashierId}) - canEditPrices: ${p.canEditPrices}, canProcessRefunds: ${p.canProcessRefunds}`);
    });

    console.log('\n=== CASHIERS ===');
    const cashiers = await prisma.user.findMany({
      where: { role: 'cashier' },
      select: { id: true, fullName: true, email: true }
    });
    cashiers.forEach(c => {
      console.log(`ID: ${c.id}, Name: ${c.fullName}, Email: ${c.email}`);
    });

    console.log('\n=== USERS WITH ROLE CASHIER ===');
    const users = await prisma.user.findMany({
      where: { role: 'cashier' },
      select: { id: true, fullName: true, role: true }
    });
    users.forEach(u => {
      console.log(`User ID: ${u.id}, Name: ${u.fullName}, Role: ${u.role}`);
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkPermissions();
