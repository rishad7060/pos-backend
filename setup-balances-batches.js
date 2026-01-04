/**
 * Setup Customer Balances and Product Stock Batches
 * This script creates:
 * 1. Customer credit records for existing balances (as admin adjustments)
 * 2. Initial stock batches for all products with stock > 0
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function setupCustomerBalances() {
  console.log('\n💰 Setting up customer credit balances...\n');

  try {
    // Get admin user ID
    const adminUser = await prisma.user.findUnique({
      where: { email: 'admin@pos.com' }
    });

    if (!adminUser) {
      console.error('   ❌ Admin user not found!');
      return 0;
    }

    // Get all customers with non-zero credit balance
    const customersWithBalance = await prisma.customer.findMany({
      where: {
        creditBalance: {
          not: 0
        }
      },
      select: {
        id: true,
        name: true,
        creditBalance: true
      }
    });

    console.log(`   Found ${customersWithBalance.length} customers with credit balances`);

    let createdCount = 0;

    for (const customer of customersWithBalance) {
      try {
        // Create admin adjustment credit record
        await prisma.customerCredit.create({
          data: {
            customerId: customer.id,
            transactionType: 'admin_adjustment',
            amount: customer.creditBalance,
            balance: customer.creditBalance,
            description: 'Initial balance - migrated from old system',
            userId: adminUser.id
          }
        });

        createdCount++;
        console.log(`   ✅ ${customer.name}: LKR ${customer.creditBalance.toFixed(2)}`);
      } catch (error) {
        console.error(`   ❌ Failed for ${customer.name}:`, error.message.substring(0, 100));
      }
    }

    console.log(`\n   ✅ Created ${createdCount} customer credit records\n`);
    return createdCount;

  } catch (error) {
    console.error('   ❌ Error setting up customer balances:', error.message);
    return 0;
  }
}

async function setupStockBatches() {
  console.log('\n📦 Creating initial stock batches...\n');

  try {
    // Get all products with stock > 0 (exclude out of stock)
    const productsWithStock = await prisma.product.findMany({
      where: {
        stockQuantity: {
          gt: 0
        }
      },
      select: {
        id: true,
        name: true,
        stockQuantity: true,
        costPrice: true,
        sku: true
      },
      orderBy: {
        name: 'asc'
      }
    });

    console.log(`   Found ${productsWithStock.length} products with stock\n`);

    let createdCount = 0;
    const today = new Date();

    for (const product of productsWithStock) {
      try {
        // Generate batch number
        const batchNumber = `INIT-${product.id}-${Date.now()}`;

        // Use cost price if available, otherwise set to 0
        const costPrice = product.costPrice || 0;

        // Create initial stock batch
        await prisma.stockBatch.create({
          data: {
            productId: product.id,
            batchNumber: batchNumber,
            receivedDate: today,
            quantityReceived: product.stockQuantity,
            quantityRemaining: product.stockQuantity,
            costPrice: costPrice,
            notes: 'Initial stock - migrated from old system'
          }
        });

        createdCount++;
        console.log(`   ✅ ${product.name}: ${product.stockQuantity} ${product.sku || ''} @ LKR ${costPrice.toFixed(2)}`);

      } catch (error) {
        console.error(`   ❌ Failed for ${product.name}:`, error.message.substring(0, 100));
      }
    }

    console.log(`\n   ✅ Created ${createdCount} stock batches\n`);
    return createdCount;

  } catch (error) {
    console.error('   ❌ Error creating stock batches:', error.message);
    return 0;
  }
}

async function main() {
  console.log('🚀 Starting Setup: Customer Balances & Stock Batches\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const startTime = Date.now();

  try {
    // Step 1: Setup customer balances
    const customerCreditsCreated = await setupCustomerBalances();

    // Step 2: Setup stock batches
    const stockBatchesCreated = await setupStockBatches();

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Setup completed successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('📊 Summary:');
    console.log(`   Customer credits created: ${customerCreditsCreated}`);
    console.log(`   Stock batches created: ${stockBatchesCreated}`);
    console.log(`   Time taken: ${duration} seconds\n`);

    // Show final counts
    const counts = {
      customerCredits: await prisma.customerCredit.count(),
      stockBatches: await prisma.stockBatch.count(),
      customers: await prisma.customer.count(),
      products: await prisma.product.count(),
    };

    console.log('📈 Current Database Counts:');
    console.log(`   Total Customers: ${counts.customers}`);
    console.log(`   Customer Credits: ${counts.customerCredits}`);
    console.log(`   Total Products: ${counts.products}`);
    console.log(`   Stock Batches: ${counts.stockBatches}\n`);

    // Calculate total inventory value
    const batches = await prisma.stockBatch.findMany({
      select: {
        quantityRemaining: true,
        costPrice: true
      }
    });

    const totalInventoryValue = batches.reduce((sum, batch) => {
      return sum + (parseFloat(batch.quantityRemaining) * parseFloat(batch.costPrice));
    }, 0);

    console.log('💎 Inventory Value:');
    console.log(`   Total inventory worth: LKR ${totalInventoryValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n`);

  } catch (error) {
    console.error('\n❌ Fatal error during setup:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the setup
main()
  .then(() => {
    console.log('👋 Setup script finished. Exiting...\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Setup failed:', error);
    process.exit(1);
  });
