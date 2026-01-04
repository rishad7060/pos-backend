/**
 * Import Supplier Credits from Full Database Dump
 * This imports the missing supplier_credits data
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function importSupplierCredits() {
  console.log('\n💳 Importing Supplier Credits...\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  try {
    const sqlFile = path.join(__dirname, '../pos_exports/pos_db_full_with_schema.sql');
    const sqlContent = fs.readFileSync(sqlFile, 'utf8');

    // Extract INSERT statements for supplier_credits
    const regex = new RegExp(`INSERT INTO public\\.supplier_credits[^;]+;`, 'gi');
    const inserts = sqlContent.match(regex);

    if (!inserts || inserts.length === 0) {
      console.log('   ⚠️  No supplier credit data found');
      return 0;
    }

    console.log(`   Found ${inserts.length} supplier credit records\n`);

    let imported = 0;
    let skipped = 0;

    for (const insert of inserts) {
      try {
        await prisma.$executeRawUnsafe(insert);
        imported++;

        if (imported % 5 === 0) {
          process.stdout.write(`\r   Progress: ${imported}/${inserts.length} records imported`);
        }
      } catch (error) {
        skipped++;
        // Skip errors (usually duplicate or foreign key issues)
      }
    }

    console.log(`\r   ✅ Imported ${imported} supplier credit records`);
    if (skipped > 0) {
      console.log(`   ⚠️  Skipped ${skipped} records\n`);
    } else {
      console.log('');
    }

    // Now update supplier outstanding balances based on latest credit record
    console.log('\n📊 Updating supplier outstanding balances...\n');

    const suppliers = await prisma.supplier.findMany({
      select: { id: true, name: true }
    });

    let updated = 0;

    for (const supplier of suppliers) {
      // Get latest balance from supplier_credits
      const latestCredit = await prisma.supplierCredit.findFirst({
        where: { supplierId: supplier.id },
        orderBy: { createdAt: 'desc' },
        select: { balance: true }
      });

      if (latestCredit) {
        await prisma.supplier.update({
          where: { id: supplier.id },
          data: { outstandingBalance: latestCredit.balance }
        });
        updated++;
        console.log(`   ✅ ${supplier.name}: LKR ${parseFloat(latestCredit.balance).toFixed(2)}`);
      }
    }

    console.log(`\n   ✅ Updated ${updated} supplier outstanding balances\n`);

    // Show summary
    const totalCredits = await prisma.supplierCredit.count();
    const suppliersWithBalance = await prisma.supplier.count({
      where: { outstandingBalance: { not: 0 } }
    });

    const totalOutstanding = await prisma.supplier.aggregate({
      _sum: { outstandingBalance: true }
    });

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 Summary:');
    console.log(`   Total supplier credit records: ${totalCredits}`);
    console.log(`   Suppliers with outstanding balance: ${suppliersWithBalance}`);
    console.log(`   Total outstanding to suppliers: LKR ${parseFloat(totalOutstanding._sum.outstandingBalance || 0).toFixed(2)}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    return imported;

  } catch (error) {
    console.error('   ❌ Error importing supplier credits:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the import
importSupplierCredits()
  .then(() => {
    console.log('✅ Supplier credits import completed!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Import failed:', error);
    process.exit(1);
  });
