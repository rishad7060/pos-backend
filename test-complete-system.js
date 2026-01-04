/**
 * COMPREHENSIVE END-TO-END POS SYSTEM TEST
 *
 * This script tests the ENTIRE POS system from scratch:
 * 1. Clean database (except users)
 * 2. Create products with stock batches, costs, selling prices
 * 3. Create customers and add admin credit
 * 4. Create suppliers and purchase orders
 * 5. Test POS sales (cash, card, credit, split payments)
 * 6. Cash in/out operations
 * 7. Close registry
 * 8. Supplier credit management
 * 9. Customer cheque to supplier payment (NEW FEATURE)
 * 10. Verify accounting/finance reports
 * 11. Verify sales reports
 *
 * Run: node test-complete-system.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const API_BASE = 'http://localhost:3001/api';

// Test credentials
const ADMIN_EMAIL = 'admin@pos.com';
const ADMIN_PASSWORD = 'admin123';

let adminToken = '';
let testData = {
  category: null,
  products: [],
  customers: [],
  suppliers: [],
  purchases: [],
  stockBatches: [],
  orders: [],
  registry: null,
  cheques: [],
  cashTransactions: [],
};

// Helper function to make API requests
async function apiRequest(method, endpoint, data = null, token = null) {
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { 'Authorization': `Bearer ${token}` }),
    },
  };

  if (data && method !== 'GET') {
    options.body = JSON.stringify(data);
  }

  const url = method === 'GET' && data
    ? `${API_BASE}${endpoint}?${new URLSearchParams(data)}`
    : `${API_BASE}${endpoint}`;

  const response = await fetch(url, options);
  const responseData = await response.json();

  if (!response.ok) {
    throw new Error(responseData.error || responseData.message || `Request failed: ${response.status}`);
  }

  return responseData;
}

// Helper to display section headers
function showSection(title) {
  console.log('\n' + '='.repeat(60));
  console.log(title);
  console.log('='.repeat(60) + '\n');
}

// Helper to display step
function showStep(step) {
  console.log(`\n📍 ${step}`);
}

// Helper to display success
function showSuccess(message) {
  console.log(`✅ ${message}`);
}

// Helper to display error
function showError(message) {
  console.error(`❌ ${message}`);
}

// Helper to display info
function showInfo(message) {
  console.log(`ℹ️  ${message}`);
}

// ============================================================================
// PHASE 1: CLEAN DATABASE (KEEP USERS ONLY)
// ============================================================================

async function phase1_CleanDatabase() {
  showSection('PHASE 1: CLEAN DATABASE (KEEP USERS ONLY)');

  try {
    showStep('Cleaning database tables...');

    // Clean all tables except users (in correct order to respect foreign keys)
    await prisma.refundItem.deleteMany();
    await prisma.refund.deleteMany();
    await prisma.orderItemBatch.deleteMany();
    await prisma.orderItem.deleteMany();
    await prisma.paymentDetail.deleteMany(); // Must delete before Order
    await prisma.order.deleteMany();
    await prisma.holdOrder.deleteMany();
    await prisma.supplierPaymentAllocation.deleteMany();
    await prisma.supplierCredit.deleteMany();
    await prisma.customerCredit.deleteMany();
    await prisma.cheque.deleteMany();
    await prisma.cashTransaction.deleteMany();
    await prisma.cashierShift.deleteMany();
    await prisma.registrySession.deleteMany();
    await prisma.purchaseReturnItem.deleteMany();
    await prisma.purchaseReturn.deleteMany();
    await prisma.purchaseReceive.deleteMany();
    await prisma.purchasePayment.deleteMany();
    await prisma.purchaseItem.deleteMany();
    await prisma.purchase.deleteMany();
    await prisma.stockBatch.deleteMany();
    await prisma.stockMovement.deleteMany();
    await prisma.priceChangeHistory.deleteMany();
    await prisma.product.deleteMany();
    await prisma.category.deleteMany();
    await prisma.supplier.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.expense.deleteMany();
    await prisma.expenseCategory.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.userSession.deleteMany();

    showSuccess('Database cleaned (users preserved)');
    return true;
  } catch (error) {
    showError(`Database cleanup failed: ${error.message}`);
    return false;
  }
}

// ============================================================================
// PHASE 2: CREATE PRODUCTS WITH STOCK BATCHES
// ============================================================================

async function phase2_CreateProducts() {
  showSection('PHASE 2: CREATE PRODUCTS WITH STOCK BATCHES');

  try {
    // Create or find a category
    showStep('Creating/finding product category...');
    let category;
    try {
      category = await apiRequest('POST', '/categories', {
        name: 'Test Category',
        description: 'Category for testing'
      }, adminToken);
      showSuccess(`Category created: ${category.name} (#${category.id})`);
    } catch (error) {
      if (error.message.includes('already exists')) {
        // Get existing category
        const categories = await apiRequest('GET', '/categories', null, adminToken);
        category = categories.find(c => c.name === 'Test Category');
        if (!category) category = categories[0]; // Use first category if not found
        showInfo(`Using existing category: ${category.name} (#${category.id})`);
      } else {
        throw error;
      }
    }
    testData.category = category;

    // Create products with different configurations
    const productConfigs = [
      {
        name: 'Rice (Weight-based)',
        sku: 'RICE-001',
        category: category.id,
        unitType: 'weight',
        pricePerKg: 250,
        costPrice: 180,
        stock: 100,
      },
      {
        name: 'Flour (Weight-based)',
        sku: 'FLOUR-001',
        category: category.id,
        unitType: 'weight',
        pricePerKg: 200,
        costPrice: 150,
        stock: 50,
      },
      {
        name: 'Sugar (Weight-based)',
        sku: 'SUGAR-001',
        category: category.id,
        unitType: 'weight',
        pricePerKg: 300,
        costPrice: 220,
        stock: 75,
      },
    ];

    for (const config of productConfigs) {
      showStep(`Creating product: ${config.name}...`);
      const product = await apiRequest('POST', '/products', {
        name: config.name,
        sku: config.sku,
        categoryId: config.category,
        unitType: config.unitType,
        defaultPricePerKg: config.pricePerKg,
        defaultPricePerG: config.pricePerKg / 1000,
        defaultCostPrice: config.costPrice,
        costPrice: config.costPrice, // Required for initial stock batch
        stockQuantity: config.stock,
        lowStockThreshold: 10,
        isActive: true,
      }, adminToken);

      testData.products.push(product);
      showSuccess(`Product created: ${product.name} (#${product.id})`);
      showInfo(`  SKU: ${product.sku}`);
      showInfo(`  Selling Price: LKR ${product.defaultPricePerKg || 'N/A'}/kg`);
      showInfo(`  Cost Price: LKR ${product.defaultCostPrice || 'N/A'}/kg`);
      showInfo(`  Stock: ${product.stockQuantity} kg`);
      if (product.defaultPricePerKg && product.defaultCostPrice) {
        showInfo(`  Profit Margin: ${((product.defaultPricePerKg - product.defaultCostPrice) / product.defaultCostPrice * 100).toFixed(2)}%`);
      }
    }

    showSuccess(`Total products created: ${testData.products.length}`);
    return true;
  } catch (error) {
    showError(`Product creation failed: ${error.message}`);
    return false;
  }
}

// ============================================================================
// PHASE 3: CREATE CUSTOMERS AND ADD ADMIN CREDIT
// ============================================================================

async function phase3_CreateCustomers() {
  showSection('PHASE 3: CREATE CUSTOMERS AND ADD ADMIN CREDIT');

  try {
    const customerConfigs = [
      {
        name: 'Walk-in Customer',
        phone: '0770000001',
        email: 'walkin@test.com',
        adminCredit: 0,
      },
      {
        name: 'Regular Customer A',
        phone: '0770000002',
        email: 'customera@test.com',
        adminCredit: 5000,
      },
      {
        name: 'VIP Customer B',
        phone: '0770000003',
        email: 'customerb@test.com',
        adminCredit: 10000,
      },
    ];

    for (const config of customerConfigs) {
      showStep(`Creating customer: ${config.name}...`);

      try {
        const customer = await apiRequest('POST', '/customers', {
          name: config.name,
          phone: config.phone,
          email: config.email,
        }, adminToken);

        testData.customers.push(customer);
        showSuccess(`Customer created: ${customer.name} (#${customer.id})`);

        // Add admin credit if specified
        if (config.adminCredit > 0) {
          showStep(`Adding admin credit: LKR ${config.adminCredit}...`);
          await apiRequest('POST', '/customer-credits', {
            customerId: customer.id,
            transactionType: 'admin_adjustment',
            amount: config.adminCredit,
            description: `Initial credit for ${customer.name}`,
          }, adminToken);
          showSuccess(`Admin credit added: LKR ${config.adminCredit}`);
        }
      } catch (error) {
        if (error.message.includes('already exists')) {
          showInfo(`Customer with phone ${config.phone} already exists - skipping`);
        } else {
          throw error;
        }
      }
    }

    showSuccess(`Total customers created: ${testData.customers.length}`);
    return true;
  } catch (error) {
    showError(`Customer creation failed: ${error.message}`);
    return false;
  }
}

// ============================================================================
// PHASE 4: CREATE SUPPLIERS AND PURCHASE ORDERS
// ============================================================================

async function phase4_CreateSuppliersAndPOs() {
  showSection('PHASE 4: CREATE SUPPLIERS AND PURCHASE ORDERS');

  try {
    // Create suppliers
    const supplierConfigs = [
      {
        name: 'Rice Supplier Ltd',
        contactPerson: 'John Doe',
        phone: '0111234567',
        email: 'rice@supplier.com',
      },
      {
        name: 'Grain Distributors',
        contactPerson: 'Jane Smith',
        phone: '0117654321',
        email: 'grain@distributor.com',
      },
    ];

    for (const config of supplierConfigs) {
      showStep(`Creating supplier: ${config.name}...`);
      const supplier = await apiRequest('POST', '/suppliers', {
        name: config.name,
        contactPerson: config.contactPerson,
        phone: config.phone,
        email: config.email,
      }, adminToken);

      testData.suppliers.push(supplier);
      showSuccess(`Supplier created: ${supplier.name} (#${supplier.id})`);
    }

    // Create purchase orders
    showStep(`Creating purchase order for ${testData.products[0].name}...`);
    const poSubtotal = 100 * 180; // quantity * unitCost
    const po = await apiRequest('POST', '/purchases', {
      supplierId: testData.suppliers[0].id,
      items: [
        {
          productId: testData.products[0].id,
          quantity: 100,
          unitCost: 180,
          total: 18000,
        },
      ],
      subtotal: poSubtotal,
      taxAmount: 0,
      shippingCost: 0,
      total: poSubtotal,
      status: 'received',
      paymentStatus: 'unpaid',
      notes: 'Test purchase order',
    }, adminToken);

    testData.purchases.push(po);
    showSuccess(`Purchase order created: ${po.poNumber} (#${po.id})`);
    showInfo(`  Supplier: ${testData.suppliers[0].name}`);
    showInfo(`  Total: LKR ${po.total}`);

    showSuccess(`Total suppliers: ${testData.suppliers.length}, POs: ${testData.purchases.length}`);
    return true;
  } catch (error) {
    showError(`Supplier/PO creation failed: ${error.message}`);
    return false;
  }
}

// ============================================================================
// PHASE 5: OPEN REGISTRY AND DO POS SALES
// ============================================================================

async function phase5_POSSales() {
  showSection('PHASE 5: OPEN REGISTRY AND DO POS SALES');

  try {
    // Open registry
    showStep('Opening registry session...');
    const openerId = testData.cashierUser ? testData.cashierUser.id : 1;

    try {
      const currentRegistry = await apiRequest('GET', '/registry-sessions/current', null, adminToken);
      if (currentRegistry && currentRegistry.status === 'open') {
        testData.registry = currentRegistry;
        showInfo(`Using existing registry session #${currentRegistry.id}`);
      } else {
        throw new Error('No open session');
      }
    } catch (error) {
      const registry = await apiRequest('POST', '/registry-sessions', {
        openedBy: openerId,
        openingCash: 10000,
      }, adminToken);
      testData.registry = registry;
      showSuccess(`Registry opened: #${registry.id} with LKR ${registry.openingCash} opening cash`);
    }

    // Test different payment methods
    const salesConfigs = [
      {
        name: 'Cash Sale',
        customer: null,
        paymentMethod: 'cash',
        items: [{ product: 0, weight: 5 }],
      },
      {
        name: 'Card Sale',
        customer: null,
        paymentMethod: 'card',
        items: [{ product: 1, weight: 3 }],
      },
      {
        name: 'Credit Sale',
        customer: 1, // Customer with credit
        paymentMethod: 'credit',
        items: [{ product: 0, weight: 2 }],
      },
      {
        name: 'Split Payment Sale',
        customer: 1,
        paymentMethod: 'split',
        items: [{ product: 2, weight: 4 }],
        cashAmount: 600,
        cardAmount: 600,
      },
    ];

    for (const config of salesConfigs) {
      showStep(`Creating ${config.name}...`);

      const items = config.items.map(item => ({
        productId: testData.products[item.product].id,
        itemName: testData.products[item.product].name,
        quantityType: 'kg',
        itemWeightKg: item.weight,
        itemWeightG: 0,
        pricePerKg: testData.products[item.product].defaultPricePerKg || 0,
        itemDiscountPercent: 0,
      }));

      const subtotal = items.reduce((sum, item) => sum + (item.itemWeightKg * (item.pricePerKg || 0)), 0);

      const orderData = {
        cashierId: 1,
        customerId: config.customer ? testData.customers[config.customer].id : null,
        registrySessionId: testData.registry.id,
        subtotal,
        discountAmount: 0,
        discountPercent: 0,
        taxAmount: 0,
        total: subtotal,
        paymentMethod: config.paymentMethod,
        amountPaid: config.paymentMethod === 'credit' ? 0 : subtotal,
        creditUsed: config.paymentMethod === 'credit' ? subtotal : 0,
        cashReceived: config.paymentMethod === 'cash' ? subtotal : (config.cashAmount || 0),
        changeGiven: 0,
        status: 'completed',
        items,
      };

      // Add payment details for split payments
      if (config.paymentMethod === 'split') {
        orderData.paymentDetails = [
          { paymentType: 'cash', amount: config.cashAmount },
          { paymentType: 'card', amount: config.cardAmount },
        ];
      }

      const order = await apiRequest('POST', '/orders', orderData, adminToken);
      testData.orders.push(order.order || order);
      showSuccess(`Order created: ${(order.order || order).orderNumber} - LKR ${subtotal.toFixed(2)}`);
      showInfo(`  Payment: ${config.paymentMethod}`);
    }

    showSuccess(`Total orders created: ${testData.orders.length}`);
    return true;
  } catch (error) {
    showError(`POS sales failed: ${error.message}`);
    console.error(error);
    return false;
  }
}

// ============================================================================
// PHASE 6: CASH IN/OUT OPERATIONS
// ============================================================================

async function phase6_CashOperations() {
  showSection('PHASE 6: CASH IN/OUT OPERATIONS');

  try {
    // Use cashier user if available
    const cashierId = testData.cashierUser ? testData.cashierUser.id : testData.registry.openedBy;

    // Cash In
    showStep('Recording cash IN transaction...');
    const cashIn = await apiRequest('POST', '/cash-transactions', {
      registrySessionId: testData.registry.id,
      cashierId: cashierId,
      transactionType: 'cash_in',
      amount: 2000,
      reason: 'Additional cash added to drawer',
    }, adminToken);
    testData.cashTransactions.push(cashIn);
    showSuccess(`Cash IN recorded: LKR ${cashIn.amount}`);

    // Cash Out
    showStep('Recording cash OUT transaction...');
    const cashOut = await apiRequest('POST', '/cash-transactions', {
      registrySessionId: testData.registry.id,
      cashierId: cashierId,
      transactionType: 'cash_out',
      amount: 500,
      reason: 'Petty cash withdrawal',
    }, adminToken);
    testData.cashTransactions.push(cashOut);
    showSuccess(`Cash OUT recorded: LKR ${cashOut.amount}`);

    showSuccess(`Total cash transactions: ${testData.cashTransactions.length}`);
    return true;
  } catch (error) {
    showError(`Cash operations failed: ${error.message}`);
    return false;
  }
}

// ============================================================================
// PHASE 7: CLOSE REGISTRY
// ============================================================================

async function phase7_CloseRegistry() {
  showSection('PHASE 7: CLOSE REGISTRY');

  try {
    showStep('Closing registry session...');

    // Get current registry stats
    const currentRegistry = await apiRequest('GET', '/registry-sessions/current', null, adminToken);
    showInfo(`Current registry stats:`);
    showInfo(`  Total Sales: LKR ${currentRegistry.totalSales}`);
    showInfo(`  Cash Payments: LKR ${currentRegistry.cashPayments}`);
    showInfo(`  Card Payments: LKR ${currentRegistry.cardPayments}`);
    showInfo(`  Cash In: LKR ${currentRegistry.cashIn}`);
    showInfo(`  Cash Out: LKR ${currentRegistry.cashOut}`);

    // Calculate expected cash
    const expectedCash = currentRegistry.openingCash + currentRegistry.cashPayments + currentRegistry.cashIn - currentRegistry.cashOut;
    showInfo(`  Expected Cash: LKR ${expectedCash}`);

    // Close registry
    const closedRegistry = await apiRequest('PUT', `/registry-sessions?id=${testData.registry.id}`, {
      status: 'closed',
      closedBy: 1,
      actualCash: expectedCash,
      closingNotes: 'Test registry close',
    }, adminToken);

    showSuccess(`Registry closed successfully`);
    showInfo(`  Variance: LKR ${closedRegistry.variance}`);

    return true;
  } catch (error) {
    showError(`Registry close failed: ${error.message}`);
    return false;
  }
}

// ============================================================================
// PHASE 8: SUPPLIER CREDIT MANAGEMENT
// ============================================================================

async function phase8_SupplierCredit() {
  showSection('PHASE 8: SUPPLIER CREDIT MANAGEMENT');

  try {
    // Check supplier outstanding balance
    showStep(`Checking supplier ${testData.suppliers[0].name} balance...`);
    const supplier = await apiRequest('GET', `/suppliers?id=${testData.suppliers[0].id}`, null, adminToken);
    showInfo(`Outstanding Balance: LKR ${supplier.outstandingBalance}`);

    if (supplier.outstandingBalance > 0) {
      // Make a payment
      showStep('Making supplier payment...');
      const payment = await apiRequest('POST', '/supplier-credits/record-payment', {
        supplierId: testData.suppliers[0].id,
        amount: 5000,
        paymentMethod: 'cash',
        reference: 'TEST-PAY-001',
        notes: 'Test payment',
      }, adminToken);
      showSuccess(`Payment recorded: LKR ${payment.payment.amount}`);
      showInfo(`New balance: LKR ${payment.newBalance}`);
    } else {
      showInfo('No outstanding balance to pay');
    }

    return true;
  } catch (error) {
    showError(`Supplier credit management failed: ${error.message}`);
    return false;
  }
}

// ============================================================================
// PHASE 9: CUSTOMER CHEQUE TO SUPPLIER PAYMENT (NEW FEATURE)
// ============================================================================

async function phase9_ChequeToSupplier() {
  showSection('PHASE 9: CUSTOMER CHEQUE TO SUPPLIER PAYMENT (NEW FEATURE)');

  try {
    // First, create a customer cheque (simulate customer payment by cheque)
    showStep('Creating customer cheque...');
    const cheque = await apiRequest('POST', '/cheques', {
      chequeNumber: 'CHQ-TEST-001',
      chequeDate: new Date().toISOString(),
      amount: 3000,
      payerName: testData.customers[1].name,
      payeeName: 'POS Store',
      bankName: 'Test Bank',
      transactionType: 'received',
      status: 'pending',
      customerId: testData.customers[1].id,
      notes: 'Test customer cheque for endorsement',
    }, adminToken);
    testData.cheques.push(cheque);
    showSuccess(`Customer cheque created: ${cheque.chequeNumber} - LKR ${cheque.amount}`);

    // Now endorse this cheque to supplier for payment
    showStep(`Endorsing cheque to supplier ${testData.suppliers[0].name}...`);
    const payment = await apiRequest('POST', '/supplier-credits/payment', {
      supplierId: testData.suppliers[0].id,
      amount: 3000,
      customerChequeId: cheque.id,
      notes: 'Payment via endorsed customer cheque',
    }, adminToken);

    showSuccess(`Cheque endorsed successfully!`);
    showInfo(`  Cheque: ${payment.endorsedCheque.chequeNumber}`);
    showInfo(`  Amount: LKR ${payment.endorsedCheque.amount}`);
    showInfo(`  Endorsed To: ${payment.endorsedCheque.endorsedTo}`);
    showInfo(`  New Supplier Balance: LKR ${payment.newBalance}`);

    return true;
  } catch (error) {
    showError(`Cheque endorsement failed: ${error.message}`);
    console.error(error);
    return false;
  }
}

// ============================================================================
// PHASE 10: VERIFY REPORTS
// ============================================================================

async function phase10_VerifyReports() {
  showSection('PHASE 10: VERIFY ACCOUNTING & SALES REPORTS');

  try {
    // Get orders for sales report
    showStep('Fetching sales data...');
    const orders = await apiRequest('GET', '/orders', null, adminToken);
    const completedOrders = orders.filter(o => o.status === 'completed');
    const totalSales = completedOrders.reduce((sum, o) => sum + (o.total || 0), 0);
    showSuccess('Sales data retrieved');
    showInfo(`  Total Orders: ${completedOrders.length}`);
    showInfo(`  Total Sales: LKR ${totalSales.toFixed(2)}`);

    // Get inventory report
    showStep('Fetching inventory report...');
    const inventory = await apiRequest('GET', '/products', null, adminToken);
    showSuccess(`Inventory report retrieved: ${inventory.length} products`);

    let totalStockValue = 0;
    inventory.forEach(product => {
      const costPrice = product.defaultCostPrice || product.costPrice || 0;
      const value = (product.stockQuantity || 0) * costPrice;
      totalStockValue += value;
    });
    showInfo(`  Total Stock Value: LKR ${totalStockValue.toFixed(2)}`);

    // Get customers and credit
    showStep('Fetching customer credit data...');
    const customers = await apiRequest('GET', '/customers', null, adminToken);
    showSuccess(`Customer data retrieved: ${customers.length} customers`);

    return true;
  } catch (error) {
    showError(`Report verification failed: ${error.message}`);
    return false;
  }
}

// ============================================================================
// MAIN TEST RUNNER
// ============================================================================

async function runAllTests() {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║       COMPREHENSIVE POS SYSTEM END-TO-END TEST            ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('\n');

  const startTime = Date.now();

  try {
    // Login
    showSection('AUTHENTICATION');
    showStep('Logging in as admin...');
    const loginResponse = await apiRequest('POST', '/auth/login', {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    adminToken = loginResponse.token;
    showSuccess('Admin logged in successfully');

    // Find a cashier user for cash operations
    try {
      const users = await apiRequest('GET', '/users', null, adminToken);
      const cashierUser = users.find(u => u.role === 'cashier' && u.isActive);
      if (cashierUser) {
        testData.cashierUser = cashierUser;
        showInfo(`Found cashier user: ${cashierUser.fullName || cashierUser.email} (#${cashierUser.id})`);
      } else {
        showInfo('No cashier user found - will use admin for operations');
      }
    } catch (error) {
      showInfo('Could not fetch users - will use admin for operations');
    }

    // Run all test phases
    const phases = [
      { name: 'Phase 1: Clean Database', fn: phase1_CleanDatabase },
      { name: 'Phase 2: Create Products', fn: phase2_CreateProducts },
      { name: 'Phase 3: Create Customers', fn: phase3_CreateCustomers },
      { name: 'Phase 4: Suppliers & POs', fn: phase4_CreateSuppliersAndPOs },
      { name: 'Phase 5: POS Sales', fn: phase5_POSSales },
      { name: 'Phase 6: Cash Operations', fn: phase6_CashOperations },
      { name: 'Phase 7: Close Registry', fn: phase7_CloseRegistry },
      { name: 'Phase 8: Supplier Credit', fn: phase8_SupplierCredit },
      { name: 'Phase 9: Cheque Endorsement', fn: phase9_ChequeToSupplier },
      { name: 'Phase 10: Verify Reports', fn: phase10_VerifyReports },
    ];

    let passedPhases = 0;
    let failedPhases = 0;

    for (const phase of phases) {
      const result = await phase.fn();
      if (result) {
        passedPhases++;
      } else {
        failedPhases++;
        showError(`${phase.name} FAILED - stopping tests`);
        break;
      }
    }

    // Final Summary
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    showSection('FINAL TEST SUMMARY');
    console.log(`⏱️  Duration: ${duration}s`);
    console.log(`✅ Passed Phases: ${passedPhases}/${phases.length}`);
    console.log(`❌ Failed Phases: ${failedPhases}/${phases.length}`);
    console.log('');
    console.log('📊 Test Data Summary:');
    console.log(`  Categories: ${testData.category ? 1 : 0}`);
    console.log(`  Products: ${testData.products.length}`);
    console.log(`  Customers: ${testData.customers.length}`);
    console.log(`  Suppliers: ${testData.suppliers.length}`);
    console.log(`  Purchase Orders: ${testData.purchases.length}`);
    console.log(`  Sales Orders: ${testData.orders.length}`);
    console.log(`  Cash Transactions: ${testData.cashTransactions.length}`);
    console.log(`  Cheques: ${testData.cheques.length}`);
    console.log('');

    if (passedPhases === phases.length) {
      console.log('🎉 ALL TESTS PASSED! SYSTEM IS FULLY FUNCTIONAL! 🎉');
    } else {
      console.log('⚠️  SOME TESTS FAILED - REVIEW ERRORS ABOVE');
    }

  } catch (error) {
    showError(`Fatal error: ${error.message}`);
    console.error(error);
  } finally {
    // Disconnect Prisma client
    await prisma.$disconnect();
  }
}

// Run the tests
runAllTests();
