const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkUsers() {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true
      }
    });

    console.log('\n👥 All Users in Database:\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    users.forEach(u => {
      console.log(`  ID: ${u.id} | ${u.email}`);
      console.log(`       Name: ${u.fullName} | Role: ${u.role} | Active: ${u.isActive}`);
      console.log('');
    });
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Check for admin user
    const adminUser = users.find(u => u.role === 'admin');
    if (adminUser) {
      console.log('✅ Admin user found:', adminUser.email);
      console.log('   Password: (check migration notes or old system)\n');
    } else {
      console.log('⚠️  No admin user found!\n');
    }

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkUsers();
