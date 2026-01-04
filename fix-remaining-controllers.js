/**
 * Fix Remaining Controllers - Simple Direct Replacement
 */

const fs = require('fs');
const path = require('path');

const CONTROLLERS_DIR = path.join(__dirname, 'src', 'controllers');

const CONTROLLERS = [
  'SuppliersController.ts',
  'OrdersController.ts',
  'PurchasesController.ts',
  'RegistrySessionsController.ts',
  'CashTransactionsController.ts',
  'ExpensesController.ts',
  'StockMovementsController.ts',
  'AuditLogsController.ts',
  'StubControllers.ts',
];

console.log('🔧 Fixing Remaining Controllers...\n');

CONTROLLERS.forEach(file => {
  const filePath = path.join(CONTROLLERS_DIR, file);

  if (!fs.existsSync(filePath)) {
    console.log(`⚠️  Skip: ${file} (not found)`);
    return;
  }

  try {
    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;

    // Add import if not exists
    if (!content.includes("from '../config/pagination'")) {
      // Find the position after the last import
      const lines = content.split('\n');
      let lastImportLine = 0;

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('import ')) {
          lastImportLine = i;
        }
        if (lines[i].startsWith('export ') || lines[i].includes('export class')) {
          break;
        }
      }

      lines.splice(lastImportLine + 1, 0, "import { parseLimit } from '../config/pagination';");
      content = lines.join('\n');
      modified = true;
    }

    // Replace all hardcoded limit defaults
    content = content.replace(/limit\s*=\s*50\b/g, 'limit');
    content = content.replace(/limit\s*=\s*100\b/g, 'limit');
    content = content.replace(/limit\s*=\s*200\b/g, 'limit');
    content = content.replace(/limit\s*=\s*1000\b/g, 'limit');

    // Replace Math.min patterns
    content = content.replace(/Math\.min\(parseInt\(limit as string\),?\s*\d+\)/g, "parseLimit(limit, 'orders')");

    // Replace parseInt pattern
    content = content.replace(/parseInt\(limit as string\)\s*\|\|\s*\d+/g, "parseLimit(limit, 'orders')");

    if (content !== fs.readFileSync(filePath, 'utf8')) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`✅ Fixed: ${file}`);
      modified = true;
    } else if (!modified) {
      console.log(`ℹ️  No changes: ${file}`);
    }
  } catch (error) {
    console.error(`❌ Error: ${file} - ${error.message}`);
  }
});

console.log('\n✨ Done!\n');
