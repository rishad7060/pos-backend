/**
 * Automated Script to Update All Controllers with Proper Pagination
 *
 * This script updates all controller files to use the centralized pagination configuration
 * instead of hardcoded limits.
 */

const fs = require('fs');
const path = require('path');

// Controller files to update with their entity types
const CONTROLLERS = [
  { file: 'CustomersController.ts', entity: 'customers' },
  { file: 'SuppliersController.ts', entity: 'suppliers' },
  { file: 'OrdersController.ts', entity: 'orders' },
  { file: 'PurchasesController.ts', entity: 'purchases' },
  { file: 'RefundsController.ts', entity: 'refunds' },
  { file: 'RegistrySessionsController.ts', entity: 'registrySessions' },
  { file: 'CashTransactionsController.ts', entity: 'cashTransactions' },
  { file: 'ChequesController.ts', entity: 'cheques' },
  { file: 'CustomerCreditsController.ts', entity: 'customerCredits' },
  { file: 'SupplierCreditsController.ts', entity: 'supplierCredits' },
  { file: 'ExpensesController.ts', entity: 'expenses' },
  { file: 'BatchController.ts', entity: 'batches' },
  { file: 'StockMovementsController.ts', entity: 'stockMovements' },
  { file: 'AuditLogsController.ts', entity: 'auditLogs' },
  { file: 'ReportsController.ts', entity: 'orders' }, // Uses orders entity type
  { file: 'PurchaseReturnsController.ts', entity: 'purchaseReturns' },
  { file: 'StubControllers.ts', entity: 'orders' },
];

const CONTROLLERS_DIR = path.join(__dirname, 'src', 'controllers');

console.log('🔄 Starting Pagination Update Process...\n');

let updatedCount = 0;
let skippedCount = 0;
let errorCount = 0;

CONTROLLERS.forEach(({ file, entity }) => {
  const filePath = path.join(CONTROLLERS_DIR, file);

  if (!fs.existsSync(filePath)) {
    console.log(`⚠️  Skipped: ${file} (not found)`);
    skippedCount++;
    return;
  }

  try {
    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;

    // Check if pagination import already exists
    if (!content.includes("from '../config/pagination'")) {
      // Add import after other imports
      const importRegex = /(import.*?from.*?';?\n)/g;
      const imports = content.match(importRegex) || [];
      const lastImportIndex = content.lastIndexOf(imports[imports.length - 1]) + imports[imports.length - 1].length;

      content = content.slice(0, lastImportIndex) +
        "import { parseLimit, getPaginationParams } from '../config/pagination';\n" +
        content.slice(lastImportIndex);

      modified = true;
    }

    // Replace common pagination patterns
    const patterns = [
      {
        // Pattern: limit = 50, limit = 100, etc.
        regex: /limit\s*=\s*(\d+)/g,
        replacement: (match) => {
          // Keep the variable name but remove the hardcoded default
          return `limit`;
        }
      },
      {
        // Pattern: Math.min(parseInt(limit as string), 1000)
        regex: /Math\.min\(parseInt\(limit as string\),?\s*\d+\)|parseInt\(limit as string\)\s*\|\|\s*\d+/g,
        replacement: () => `parseLimit(limit, '${entity}')`
      },
      {
        // Pattern: const take = limit ? parseInt(limit) : 100
        regex: /const\s+take\s*=\s*limit\s*\?\s*(?:Math\.min\()?parseInt\(limit(?:\s+as\s+string)?\)(?:,\s*\d+\))?\s*:\s*\d+;?/g,
        replacement: () => `const take = parseLimit(limit, '${entity}');`
      },
      {
        // Pattern: take: limit ? Math.min(...) : 100
        regex: /take:\s*limit\s*\?\s*Math\.min\(parseInt\(limit(?:\s+as\s+string)?\),?\s*\d+\)\s*:\s*\d+/g,
        replacement: () => `take: parseLimit(limit, '${entity}')`
      },
    ];

    patterns.forEach(({ regex, replacement }) => {
      const before = content;
      content = content.replace(regex, replacement);
      if (content !== before) {
        modified = true;
      }
    });

    if (modified) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`✅ Updated: ${file}`);
      updatedCount++;
    } else {
      console.log(`ℹ️  No changes: ${file}`);
      skippedCount++;
    }
  } catch (error) {
    console.error(`❌ Error updating ${file}:`, error.message);
    errorCount++;
  }
});

console.log(`\n${'='.repeat(60)}`);
console.log(`📊 Update Summary:`);
console.log(`  ✅ Updated: ${updatedCount} files`);
console.log(`  ℹ️  Skipped: ${skippedCount} files`);
console.log(`  ❌ Errors: ${errorCount} files`);
console.log(`${'='.repeat(60)}\n`);

if (errorCount === 0) {
  console.log('🎉 Pagination update completed successfully!');
  console.log('\n📝 Next steps:');
  console.log('  1. Test the backend with: npm run dev');
  console.log('  2. Verify API endpoints return correct data');
  console.log('  3. Update frontend to remove hardcoded limits\n');
} else {
  console.log('⚠️  Some errors occurred. Please review and fix manually.\n');
  process.exit(1);
}
