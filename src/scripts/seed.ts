import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create admin user
  const adminPassword = await bcrypt.hash('admin123', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@pos.com' },
    update: {},
    create: {
      email: 'admin@pos.com',
      passwordHash: adminPassword,
      fullName: 'Admin User',
      role: 'admin',
    },
  });
  console.log('✅ Admin user created/updated:', admin.email);

  // Create manager user
  const managerPassword = await bcrypt.hash('manager123', 12);
  const manager = await prisma.user.upsert({
    where: { email: 'manager@pos.com' },
    update: {},
    create: {
      email: 'manager@pos.com',
      passwordHash: managerPassword,
      fullName: 'Store Manager',
      role: 'manager',
    },
  });
  console.log('✅ Manager user created/updated:', manager.email);

  // Create manager permissions
  const managerPermissions = await prisma.managerPermission.upsert({
    where: { managerId: manager.id },
    update: {},
    create: {
      managerId: manager.id,
      canViewDashboard: true,
      canViewReports: true,
      canExportReports: true,
      canViewProducts: true,
      canCreateProducts: true,
      canEditProducts: true,
      canUpdateStock: true,
      canViewOrders: true,
      canViewCustomers: true,
      canCreateCustomers: true,
      canEditCustomers: true,
      canViewPurchases: true,
      canCreatePurchases: true,
      canViewExpenses: true,
      canViewFinancialSummary: true,
    },
  });
  console.log('✅ Manager permissions created/updated');

  // Create cashier users
  const cashierPassword = await bcrypt.hash('cashier123', 12);
  const cashier1 = await prisma.user.upsert({
    where: { email: 'cashier1@pos.com' },
    update: {},
    create: {
      email: 'cashier1@pos.com',
      passwordHash: cashierPassword,
      fullName: 'Cashier One',
      role: 'cashier',
    },
  });
  console.log('✅ Cashier 1 created/updated:', cashier1.email);

  const cashier2 = await prisma.user.upsert({
    where: { email: 'cashier2@pos.com' },
    update: {},
    create: {
      email: 'cashier2@pos.com',
      passwordHash: cashierPassword,
      fullName: 'Cashier Two',
      role: 'cashier',
    },
  });
  console.log('✅ Cashier 2 created/updated:', cashier2.email);

  // Create PINs for cashiers (for PIN-based login)
  // Cashier 1 PIN: 123456
  const cashier1Pin = await prisma.cashierPin.upsert({
    where: { userId: cashier1.id },
    update: {},
    create: {
      userId: cashier1.id,
      pin: '123456',
      isActive: true,
      assignedBy: admin.id,
    },
  });
  console.log('✅ Cashier 1 PIN created/updated: 123456');

  // Cashier 2 PIN: 654321
  const cashier2Pin = await prisma.cashierPin.upsert({
    where: { userId: cashier2.id },
    update: {},
    create: {
      userId: cashier2.id,
      pin: '654321',
      isActive: true,
      assignedBy: admin.id,
    },
  });
  console.log('✅ Cashier 2 PIN created/updated: 654321');

  // Create sample products (check if they exist first)
  const productNames = ['Dry Fish KET', 'Fresh Tuna', 'Chicken Breast'];
  const productData = [
    {
      name: 'Dry Fish KET',
      description: 'Premium dried fish',
      defaultPricePerKg: 100.0,
      category: 'Seafood',
      stockQuantity: 50,
      reorderLevel: 10,
    },
    {
      name: 'Fresh Tuna',
      description: 'Fresh tuna fillets',
      defaultPricePerKg: 250.0,
      category: 'Seafood',
      stockQuantity: 20,
      reorderLevel: 5,
    },
    {
      name: 'Chicken Breast',
      description: 'Fresh chicken breast',
      defaultPricePerKg: 180.0,
      category: 'Meat',
      stockQuantity: 30,
      reorderLevel: 8,
    },
  ];

  const products = await Promise.all(
    productData.map(async (data) => {
      const existing = await prisma.product.findFirst({
        where: { name: data.name },
      });

      if (existing) {
        console.log(`⏭️  Product already exists: ${data.name}`);
        return existing;
      }

      const product = await prisma.product.create({ data });
      console.log(`✅ Product created: ${product.name}`);
      return product;
    })
  );

  // Create sample customers (using upsert with email as unique key)
  const customer1 = await prisma.customer.upsert({
    where: { email: 'customer1@example.com' },
    update: {},
    create: {
      name: 'John Doe',
      email: 'customer1@example.com',
      phone: '+1234567890',
      address: '123 Main St',
    },
  });
  console.log('✅ Customer 1 created/updated:', customer1.name);

  const customer2 = await prisma.customer.upsert({
    where: { email: 'customer2@example.com' },
    update: {},
    create: {
      name: 'Jane Smith',
      email: 'customer2@example.com',
      phone: '+0987654321',
      address: '456 Oak Ave',
    },
  });
  console.log('✅ Customer 2 created/updated:', customer2.name);

  const customer3 = await prisma.customer.upsert({
    where: { email: 'customer3@example.com' },
    update: {},
    create: {
      name: 'Bob Johnson',
      email: 'customer3@example.com',
      phone: '+1122334455',
      address: '789 Pine St',
    },
  });
  console.log('✅ Customer 3 created/updated:', customer3.name);

  // Create default expense categories
  const officeSupplies = await prisma.expenseCategory.upsert({
    where: { name: 'Office Supplies' },
    update: {},
    create: {
      name: 'Office Supplies',
      description: 'Stationery, printing materials, and office supplies',
      isActive: true,
    },
  });

  const utilities = await prisma.expenseCategory.upsert({
    where: { name: 'Utilities' },
    update: {},
    create: {
      name: 'Utilities',
      description: 'Electricity, water, internet, and phone bills',
      isActive: true,
    },
  });

  const rent = await prisma.expenseCategory.upsert({
    where: { name: 'Rent' },
    update: {},
    create: {
      name: 'Rent',
      description: 'Monthly rent and lease payments',
      isActive: true,
    },
  });

  const transportation = await prisma.expenseCategory.upsert({
    where: { name: 'Transportation' },
    update: {},
    create: {
      name: 'Transportation',
      description: 'Fuel, vehicle maintenance, and transportation costs',
      isActive: true,
    },
  });

  const marketing = await prisma.expenseCategory.upsert({
    where: { name: 'Marketing' },
    update: {},
    create: {
      name: 'Marketing',
      description: 'Advertising, promotions, and marketing expenses',
      isActive: true,
    },
  });

  console.log('✅ Default expense categories created');

  console.log('\n✅ Database seeded successfully!');
  console.log('\n📝 Demo Accounts:');
  console.log('   Admin: admin@pos.com / admin123');
  console.log('   Cashier 1: cashier1@pos.com / cashier123 (PIN: 123456)');
  console.log('   Cashier 2: cashier2@pos.com / cashier123 (PIN: 654321)');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
