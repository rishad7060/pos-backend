/**
 * Import SQL dump files into the database
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function importSQLFile(filePath, tableName) {
  try {
    console.log(`\n📥 Importing ${tableName}...`);

    // Read the SQL file
    const sqlContent = fs.readFileSync(filePath, 'utf8');

    // Extract only the INSERT statements
    const insertStatements = sqlContent
      .split('\n')
      .filter(line => line.trim().startsWith('INSERT INTO'))
      .join('\n');

    if (!insertStatements) {
      console.log(`   ⚠️  No INSERT statements found in ${path.basename(filePath)}`);
      return 0;
    }

    // Split by semicolons to get individual statements
    const statements = insertStatements
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0);

    console.log(`   Found ${statements.length} INSERT statements`);

    let successCount = 0;
    let errorCount = 0;

    // Execute each INSERT statement
    for (let i = 0; i < statements.length; i++) {
      try {
        await prisma.$executeRawUnsafe(statements[i]);
        successCount++;

        // Progress indicator
        if ((i + 1) % 10 === 0 || i === statements.length - 1) {
          process.stdout.write(`\r   Progress: ${i + 1}/${statements.length} records imported`);
        }
      } catch (error) {
        errorCount++;
        // Most errors will be due to duplicate IDs, which is expected if re-importing
        if (!error.message.includes('duplicate key')) {
          console.error(`\n   Error importing record ${i + 1}:`, error.message.substring(0, 100));
        }
      }
    }

    console.log(`\n   ✅ Successfully imported ${successCount} records`);
    if (errorCount > 0) {
      console.log(`   ⚠️  Skipped ${errorCount} records (likely duplicates)`);
    }

    return successCount;

  } catch (error) {
    console.error(`   ❌ Error importing ${tableName}:`, error.message);
    return 0;
  }
}

async function importAllData() {
  console.log('🚀 Starting data import from pos_exports/\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const startTime = Date.now();
  let totalRecords = 0;

  try {
    // Import in order to respect foreign key constraints
    const imports = [
      { file: '../pos_exports/suppliers.sql', table: 'Suppliers' },
      { file: '../pos_exports/customers.sql', table: 'Customers' },
      { file: '../pos_exports/products.sql', table: 'Products' },
      { file: '../pos_exports/stock_movements.sql', table: 'Stock Movements' }
    ];

    for (const { file, table } of imports) {
      const filePath = path.join(__dirname, file);

      if (!fs.existsSync(filePath)) {
        console.log(`   ⚠️  File not found: ${file}`);
        continue;
      }

      const count = await importSQLFile(filePath, table);
      totalRecords += count;
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Data import completed successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log(`📊 Summary:`);
    console.log(`   Total records imported: ${totalRecords}`);
    console.log(`   Time taken: ${duration} seconds\n`);

    // Show final counts
    const counts = {
      suppliers: await prisma.supplier.count(),
      customers: await prisma.customer.count(),
      products: await prisma.product.count(),
      stockMovements: await prisma.stockMovement.count(),
    };

    console.log('📈 Current Database Counts:');
    console.log(`   Suppliers: ${counts.suppliers}`);
    console.log(`   Customers: ${counts.customers}`);
    console.log(`   Products: ${counts.products}`);
    console.log(`   Stock Movements: ${counts.stockMovements}\n`);

  } catch (error) {
    console.error('\n❌ Fatal error during import:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the import
importAllData()
  .then(() => {
    console.log('👋 Import script finished. Exiting...\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Import failed:', error);
    process.exit(1);
  });
