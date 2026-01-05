/**
 * Fix Auto-Increment Sequences
 *
 * This script fixes PostgreSQL sequence issues that occur when:
 * - Data is imported/restored from backups
 * - Manual inserts are done with specific IDs
 * - The sequence counter gets out of sync
 *
 * Run this script:
 * - After restoring from backup
 * - If you get "Unique constraint failed on id" errors
 * - Before deploying to production
 *
 * Usage: npm run fix:sequences
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixSequences() {
  console.log('🔧 Fixing auto-increment sequences...\n');

  const tables = [
    'customers',
    'users',
    'products',
    'orders',
    'categories',
    'suppliers',
    'order_items',
    'refunds',
    'expenses',
    'cashier_shifts',
    'registry_sessions',
    'stock_movements',
    'audit_logs',
    'stock_batches',
    'customer_credits',
    'supplier_credits',
    'cheques',
    'cash_transactions',
    'purchase_payments',
    'purchase_receives',
    'purchase_orders',
    'purchase_items',
    'purchase_return_items',
    'refund_items',
    'payment_details',
    'cashier_pins',
    'hold_orders',
    'hold_order_items',
    'price_change_history',
    'user_sessions',
    'branches',
  ];

  try {
    for (const table of tables) {
      try {
        // Reset sequence to max(id) + 1
        await prisma.$executeRawUnsafe(`
          SELECT setval('${table}_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM ${table}), false);
        `);

        // Get the new sequence value
        const result: any = await prisma.$queryRawUnsafe(`
          SELECT last_value FROM ${table}_id_seq;
        `);

        const nextId = result[0]?.last_value || 'N/A';
        console.log(`✅ ${table.padEnd(25)} - Next ID: ${nextId}`);
      } catch (error: any) {
        // Skip tables that don't exist or don't have id sequence
        if (error.message.includes('does not exist') || error.message.includes('relation') || error.message.includes('null')) {
          console.log(`⏭️  ${table.padEnd(25)} - Skipped (no sequence)`);
        } else {
          console.error(`❌ ${table.padEnd(25)} - Error: ${error.message}`);
        }
      }
    }

    console.log('\n✨ Sequence fix completed successfully!\n');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the fix
fixSequences();
