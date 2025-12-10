import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as oldSchema from '../../../src/db/schema';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

// Initialize connections
const tursoClient = createClient({
  url: process.env.TURSO_CONNECTION_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

const oldDb = drizzle(tursoClient, { schema: oldSchema });
const newDb = new PrismaClient();

async function migrateUsers() {
  console.log('Migrating users...');

  const users = await oldDb.select().from(oldSchema.users);
  console.log(`Found ${users.length} users to migrate`);

  for (const user of users) {
    try {
      await newDb.user.create({
        data: {
          id: user.id,
          email: user.email,
          passwordHash: user.passwordHash, // Keep the same hash
          fullName: user.fullName,
          role: user.role,
          isActive: user.isActive,
          createdAt: new Date(user.createdAt),
          updatedAt: new Date(user.updatedAt),
        },
      });
      console.log(`✓ Migrated user: ${user.email}`);
    } catch (error) {
      console.error(`✗ Failed to migrate user ${user.email}:`, error);
    }
  }
}

async function migrateProducts() {
  console.log('Migrating products...');

  const products = await oldDb.select().from(oldSchema.products);
  console.log(`Found ${products.length} products to migrate`);

  for (const product of products) {
    try {
      await newDb.product.create({
        data: {
          id: product.id,
          name: product.name,
          description: product.description || null,
          defaultPricePerKg: product.defaultPricePerKg ? parseFloat(product.defaultPricePerKg.toString()) : null,
          category: product.category || null,
          isActive: product.isActive,
          sku: product.sku || null,
          barcode: product.barcode || null,
          imageUrl: product.imageUrl || null,
          stockQuantity: product.stockQuantity,
          reorderLevel: product.reorderLevel,
          unitType: product.unitType,
          costPrice: product.costPrice ? parseFloat(product.costPrice.toString()) : null,
          alertsEnabled: product.alertsEnabled,
          alertEmail: product.alertEmail || null,
          minStockLevel: product.minStockLevel || null,
          maxStockLevel: product.maxStockLevel || null,
          createdAt: new Date(product.createdAt),
          updatedAt: new Date(product.updatedAt),
        },
      });
      console.log(`✓ Migrated product: ${product.name}`);
    } catch (error) {
      console.error(`✗ Failed to migrate product ${product.name}:`, error);
    }
  }
}

async function migrateCustomers() {
  console.log('Migrating customers...');

  const customers = await oldDb.select().from(oldSchema.customers);
  console.log(`Found ${customers.length} customers to migrate`);

  for (const customer of customers) {
    try {
      await newDb.customer.create({
        data: {
          id: customer.id,
          name: customer.name,
          phone: customer.phone || null,
          email: customer.email || null,
          address: customer.address || null,
          totalPurchases: parseFloat(customer.totalPurchases.toString()),
          visitCount: customer.visitCount,
          createdAt: new Date(customer.createdAt),
          updatedAt: new Date(customer.updatedAt),
        },
      });
      console.log(`✓ Migrated customer: ${customer.name}`);
    } catch (error) {
      console.error(`✗ Failed to migrate customer ${customer.name}:`, error);
    }
  }
}

async function migrateCategories() {
  console.log('Migrating categories...');

  const categories = await oldDb.select().from(oldSchema.categories);
  console.log(`Found ${categories.length} categories to migrate`);

  for (const category of categories) {
    try {
      await newDb.category.create({
        data: {
          id: category.id,
          name: category.name,
          description: category.description || null,
          createdAt: new Date(category.createdAt),
          updatedAt: new Date(category.updatedAt),
        },
      });
      console.log(`✓ Migrated category: ${category.name}`);
    } catch (error) {
      console.error(`✗ Failed to migrate category ${category.name}:`, error);
    }
  }
}

async function migrateSuppliers() {
  console.log('Migrating suppliers...');

  const suppliers = await oldDb.select().from(oldSchema.suppliers);
  console.log(`Found ${suppliers.length} suppliers to migrate`);

  for (const supplier of suppliers) {
    try {
      await newDb.supplier.create({
        data: {
          id: supplier.id,
          name: supplier.name,
          contactPerson: supplier.contactPerson || null,
          phone: supplier.phone || null,
          email: supplier.email || null,
          address: supplier.address || null,
          taxId: supplier.taxId || null,
          paymentTerms: supplier.paymentTerms || null,
          totalPurchases: parseFloat(supplier.totalPurchases.toString()),
          outstandingBalance: parseFloat(supplier.outstandingBalance.toString()),
          isActive: supplier.isActive,
          notes: supplier.notes || null,
          createdAt: new Date(supplier.createdAt),
          updatedAt: new Date(supplier.updatedAt),
        },
      });
      console.log(`✓ Migrated supplier: ${supplier.name}`);
    } catch (error) {
      console.error(`✗ Failed to migrate supplier ${supplier.name}:`, error);
    }
  }
}

async function migrateBranches() {
  console.log('Migrating branches...');

  const branches = await oldDb.select().from(oldSchema.branches);
  console.log(`Found ${branches.length} branches to migrate`);

  for (const branch of branches) {
    try {
      await newDb.branch.create({
        data: {
          id: branch.id,
          name: branch.name,
          code: branch.code,
          address: branch.address || null,
          phone: branch.phone || null,
          email: branch.email || null,
          managerId: branch.managerId || null,
          isActive: branch.isActive,
          createdAt: new Date(branch.createdAt),
          updatedAt: new Date(branch.updatedAt),
        },
      });
      console.log(`✓ Migrated branch: ${branch.name}`);
    } catch (error) {
      console.error(`✗ Failed to migrate branch ${branch.name}:`, error);
    }
  }
}

async function migrateOrders() {
  console.log('Migrating orders...');

  const orders = await oldDb.select().from(oldSchema.orders);
  console.log(`Found ${orders.length} orders to migrate`);

  for (const order of orders) {
    try {
      await newDb.order.create({
        data: {
          id: order.id,
          orderNumber: order.orderNumber,
          cashierId: order.cashierId,
          customerId: order.customerId || null,
          subtotal: parseFloat(order.subtotal.toString()),
          discountAmount: parseFloat(order.discountAmount.toString()),
          discountPercent: parseFloat(order.discountPercent.toString()),
          taxAmount: parseFloat(order.taxAmount.toString()),
          total: parseFloat(order.total.toString()),
          paymentMethod: order.paymentMethod,
          cashReceived: order.cashReceived ? parseFloat(order.cashReceived.toString()) : null,
          changeGiven: order.changeGiven ? parseFloat(order.changeGiven.toString()) : null,
          notes: order.notes || null,
          status: order.status,
          createdAt: new Date(order.createdAt),
          updatedAt: new Date(order.updatedAt),
        },
      });
      console.log(`✓ Migrated order: ${order.orderNumber}`);
    } catch (error) {
      console.error(`✗ Failed to migrate order ${order.orderNumber}:`, error);
    }
  }
}

async function migrateOrderItems() {
  console.log('Migrating order items...');

  const orderItems = await oldDb.select().from(oldSchema.orderItems);
  console.log(`Found ${orderItems.length} order items to migrate`);

  for (const item of orderItems) {
    try {
      await newDb.orderItem.create({
        data: {
          id: item.id,
          orderId: item.orderId,
          productId: item.productId || null,
          itemName: item.itemName,
          quantityType: item.quantityType,
          itemWeightKg: parseFloat(item.itemWeightKg.toString()),
          itemWeightG: parseFloat(item.itemWeightG.toString()),
          itemWeightTotalKg: parseFloat(item.itemWeightTotalKg.toString()),
          boxWeightKg: item.boxWeightKg ? parseFloat(item.boxWeightKg.toString()) : null,
          boxWeightG: item.boxWeightG ? parseFloat(item.boxWeightG.toString()) : null,
          boxWeightPerBoxKg: item.boxWeightPerBoxKg ? parseFloat(item.boxWeightPerBoxKg.toString()) : null,
          boxCount: item.boxCount || null,
          totalBoxWeightKg: item.totalBoxWeightKg ? parseFloat(item.totalBoxWeightKg.toString()) : null,
          netWeightKg: parseFloat(item.netWeightKg.toString()),
          pricePerKg: parseFloat(item.pricePerKg.toString()),
          baseTotal: parseFloat(item.baseTotal.toString()),
          itemDiscountPercent: parseFloat(item.itemDiscountPercent.toString()),
          itemDiscountAmount: parseFloat(item.itemDiscountAmount.toString()),
          finalTotal: parseFloat(item.finalTotal.toString()),
          costPrice: item.costPrice ? parseFloat(item.costPrice.toString()) : null,
          createdAt: new Date(item.createdAt),
        },
      });
      console.log(`✓ Migrated order item: ${item.itemName}`);
    } catch (error) {
      console.error(`✗ Failed to migrate order item ${item.itemName}:`, error);
    }
  }
}

async function runMigration() {
  console.log('🚀 Starting data migration from Turso to PostgreSQL...');

  try {
    // Test connections
    console.log('Testing database connections...');
    await oldDb.select().from(oldSchema.users).limit(1);
    console.log('✓ Turso connection successful');

    await newDb.$connect();
    console.log('✓ PostgreSQL connection successful');

    // Run migrations in order (respecting foreign key constraints)
    await migrateUsers();
    await migrateCategories();
    await migrateCustomers();
    await migrateSuppliers();
    await migrateBranches();
    await migrateProducts();
    await migrateOrders();
    await migrateOrderItems();

    console.log('✅ Data migration completed successfully!');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await newDb.$disconnect();
  }
}

// Run migration if this script is executed directly
if (require.main === module) {
  runMigration();
}

export { runMigration };



