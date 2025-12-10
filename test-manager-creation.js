// Test manager creation
const { PrismaClient } = require('@prisma/client');

async function testManagerCreation() {
  const prisma = new PrismaClient();

  try {
    console.log('Testing manager creation...');

    // Check if ManagerPermission table exists
    try {
      const count = await prisma.managerPermission.count();
      console.log(`ManagerPermission table exists with ${count} records`);
    } catch (error) {
      console.log('ManagerPermission table does not exist yet:', error.message);
    }

    // Try to create a test manager
    const testEmail = `test_manager_${Date.now()}@example.com`;
    const bcrypt = require('bcrypt');
    const passwordHash = await bcrypt.hash('testpass123', 10);

    console.log('Creating test manager user...');
    const user = await prisma.user.create({
      data: {
        email: testEmail,
        passwordHash,
        fullName: 'Test Manager',
        role: 'manager',
      },
    });

    console.log('✅ Manager user created successfully:', user.id);

    // Try to create manager permissions
    console.log('Trying to create manager permissions...');
    try {
      const permissions = await prisma.managerPermission.create({
        data: {
          managerId: user.id,
          canViewDashboard: true,
          canViewReports: true,
        },
      });
      console.log('✅ Manager permissions created successfully');
    } catch (permError) {
      console.log('❌ Manager permissions creation failed:', permError.message);
    }

    // Clean up test user
    await prisma.user.delete({ where: { id: user.id } });
    console.log('✅ Test user cleaned up');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testManagerCreation();

