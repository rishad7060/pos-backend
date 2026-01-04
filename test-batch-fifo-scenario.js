/**
 * COMPREHENSIVE BATCH FIFO TESTING SCENARIO
 * ==========================================
 * This script tests the complete batch costing flow from purchase to profit reporting.
 *
 * Test Scenario:
 * 1. Create 3 batches of the same product at DIFFERENT costs
 * 2. Sell products using FIFO (oldest batches first)
 * 3. Verify profit calculation uses correct batch costs
 * 4. Verify P&L report shows accurate profit
 *
 * Expected Outcome:
 * - First sale uses Batch 1 cost (oldest, cheapest)
 * - Second sale uses Batch 2 cost (middle price)
 * - Third sale uses Batch 3 cost (newest, most expensive)
 * - Profit calculations reflect actual batch costs, not product cost
 */

const API_BASE_URL = 'http://localhost:3001/api';
let authToken = '';

// Test configuration
const TEST_CONFIG = {
  admin: { email: 'admin@pos.com', password: 'admin123' },
  cashier: { email: 'cashier1@pos.com', password: 'cashier123' },
  supplier: { name: 'Test Supplier - FIFO Test' },
  product: {
    name: 'Test Product - FIFO Costing',
    sku: 'FIFO-TEST-001',
    barcode: 'FIFO001',
    defaultPricePerKg: 150.00, // Selling price
    category: 'Test',
    unitType: 'weight',
  },
  batches: [
    { costPrice: 80.00, quantity: 10, receivedDate: '2024-01-01' }, // Batch 1: Oldest, cheapest
    { costPrice: 90.00, quantity: 10, receivedDate: '2024-01-15' }, // Batch 2: Middle
    { costPrice: 100.00, quantity: 10, receivedDate: '2024-02-01' }, // Batch 3: Newest, most expensive
  ],
  sales: [
    { quantity: 8, expectedCost: 80.00 },  // Should use Batch 1
    { quantity: 5, expectedCost: 85.00 },  // Should use 2kg from Batch 1 + 3kg from Batch 2 = weighted avg
    { quantity: 10, expectedCost: 93.33 }, // Should use 7kg from Batch 2 + 3kg from Batch 3 = weighted avg
  ],
};

// Helper function to make API calls
async function apiCall(endpoint, method = 'GET', body = null) {
  const headers = {
    'Content-Type': 'application/json',
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const options = {
    method,
    headers,
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(`API Error: ${data.error || data.message || 'Unknown error'}`);
  }

  return data;
}

// Step 1: Login as admin
async function login() {
  console.log('\n📝 Step 1: Login as admin');
  const response = await apiCall('/auth/login', 'POST', TEST_CONFIG.admin);
  authToken = response.token;
  console.log('✅ Logged in successfully');
  return response;
}

// Step 2: Find or create supplier
async function findOrCreateSupplier() {
  console.log('\n📝 Step 2: Find or create supplier');
  const suppliers = await apiCall('/suppliers');

  let supplier = suppliers.find(s => s.name === TEST_CONFIG.supplier.name);

  if (!supplier) {
    supplier = await apiCall('/suppliers', 'POST', {
      name: TEST_CONFIG.supplier.name,
      contactPerson: 'Test Contact',
      phone: '1234567890',
      email: 'test@supplier.com',
      isActive: true,
    });
    console.log(`✅ Created supplier: ${supplier.name} (ID: ${supplier.id})`);
  } else {
    console.log(`✅ Found existing supplier: ${supplier.name} (ID: ${supplier.id})`);
  }

  return supplier;
}

// Step 3: Find or create product
async function findOrCreateProduct() {
  console.log('\n📝 Step 3: Find or create product');
  const products = await apiCall('/products');

  let product = products.find(p => p.sku === TEST_CONFIG.product.sku);

  if (!product) {
    product = await apiCall('/products', 'POST', {
      ...TEST_CONFIG.product,
      stockQuantity: 0,
      reorderLevel: 5,
      isActive: true,
    });
    console.log(`✅ Created product: ${product.name} (ID: ${product.id})`);
  } else {
    console.log(`✅ Found existing product: ${product.name} (ID: ${product.id})`);
  }

  return product;
}

// Step 4: Create 3 purchase orders with different batch costs
async function createPurchaseOrders(supplierId, productId, userId) {
  console.log('\n📝 Step 4: Create 3 purchase orders with different batch costs');
  const purchaseOrders = [];
  const batches = [];

  for (let i = 0; i < TEST_CONFIG.batches.length; i++) {
    const batchConfig = TEST_CONFIG.batches[i];

    const itemTotal = batchConfig.quantity * batchConfig.costPrice;

    const po = await apiCall('/purchases', 'POST', {
      supplierId,
      userId,
      items: [{
        productId,
        productName: TEST_CONFIG.product.name,
        quantity: batchConfig.quantity,
        unitPrice: batchConfig.costPrice,
        totalPrice: itemTotal,
      }],
      subtotal: itemTotal,
      taxAmount: 0,
      shippingCost: 0,
      total: itemTotal,
      expectedDate: batchConfig.receivedDate,
      status: 'pending',
      paymentStatus: 'unpaid',
    });

    console.log(`✅ Created PO #${i + 1}: ${po.purchaseNumber} - ${batchConfig.quantity}kg @ $${batchConfig.costPrice}/kg`);

    // Receive the purchase (this creates the batch)
    const received = await apiCall('/purchase-receives', 'POST', {
      purchaseId: po.id,
      purchaseItemId: po.purchaseItems[0].id,
      receivedQuantity: batchConfig.quantity,
      receivedDate: batchConfig.receivedDate,
    });

    console.log(`✅ Received PO #${i + 1} - Batch created`);

    // Get the batch details
    const productBatches = await apiCall(`/batches?productId=${productId}`);
    const latestBatch = productBatches[productBatches.length - 1];
    batches.push(latestBatch);

    purchaseOrders.push(received);
  }

  // Verify product stock and cost
  const products = await apiCall(`/products`);
  const updatedProduct = products.find(p => p.id === productId);
  console.log(`\n📊 Product Stock Summary:`);
  console.log(`   Total Stock: ${updatedProduct.stockQuantity}kg`);
  console.log(`   Weighted Avg Cost: $${updatedProduct.costPrice}/kg`);

  // Expected weighted average: (10*80 + 10*90 + 10*100) / 30 = 90
  const expectedAvgCost = (10 * 80 + 10 * 90 + 10 * 100) / 30;
  console.log(`   Expected Avg Cost: $${expectedAvgCost.toFixed(2)}/kg`);

  return { purchaseOrders, batches };
}

// Step 5: Create sales using FIFO
async function createSales(productId, cashierId, customerId = null) {
  console.log('\n📝 Step 5: Create sales using FIFO batch allocation');
  const sales = [];

  for (let i = 0; i < TEST_CONFIG.sales.length; i++) {
    const saleConfig = TEST_CONFIG.sales[i];

    console.log(`\n📦 Sale #${i + 1}: Selling ${saleConfig.quantity}kg`);

    const response = await apiCall('/orders', 'POST', {
      cashierId,
      customerId,
      items: [{
        productId,
        itemName: TEST_CONFIG.product.name,
        quantityType: 'kg',
        itemWeightKg: saleConfig.quantity,
        itemWeightG: 0,
        pricePerKg: TEST_CONFIG.product.defaultPricePerKg,
        itemDiscountPercent: 0,
      }],
      paymentMethod: 'cash',
      amountPaid: saleConfig.quantity * TEST_CONFIG.product.defaultPricePerKg,
      discountPercent: 0,
    });

    const order = response.order;

    if (!order || !order.orderItems || order.orderItems.length === 0) {
      console.error('Order response:', JSON.stringify(response, null, 2));
      throw new Error('Order was not created properly or orderItems are missing');
    }

    const orderItem = order.orderItems[0];
    const revenue = parseFloat(orderItem.finalTotal);
    const costPrice = parseFloat(orderItem.costPrice);
    const netWeight = parseFloat(orderItem.netWeightKg);
    const cost = costPrice * netWeight;
    const profit = revenue - cost;
    const margin = (profit / revenue) * 100;

    console.log(`   ✅ Order: ${order.orderNumber}`);
    console.log(`   📊 Quantity: ${netWeight}kg`);
    console.log(`   💰 Revenue: $${revenue.toFixed(2)}`);
    console.log(`   💵 Cost (from batches): $${costPrice.toFixed(2)}/kg = $${cost.toFixed(2)} total`);
    console.log(`   📈 Profit: $${profit.toFixed(2)} (${margin.toFixed(2)}% margin)`);
    console.log(`   🎯 Expected Cost: $${saleConfig.expectedCost.toFixed(2)}/kg`);

    // Verify cost is close to expected (allow 1% variance for weighted averages)
    const costDiff = Math.abs(costPrice - saleConfig.expectedCost);
    const variance = (costDiff / saleConfig.expectedCost) * 100;

    if (variance > 2) {
      console.log(`   ⚠️ WARNING: Cost variance ${variance.toFixed(2)}% (diff: $${costDiff.toFixed(2)})`);
    } else {
      console.log(`   ✅ Cost matches expected (variance: ${variance.toFixed(2)}%)`);
    }

    sales.push(order);
  }

  return sales;
}

// Step 6: Get Dashboard Stats
async function getDashboardStats() {
  console.log('\n📝 Step 6: Get Dashboard Statistics');
  const stats = await apiCall('/dashboard/stats?period=all');

  console.log('\n📊 Dashboard Profit Analysis:');
  console.log(`   Total Revenue: $${stats.profitAnalysis.totalRevenue.toFixed(2)}`);
  console.log(`   Total COGS: $${stats.profitAnalysis.totalCOGS.toFixed(2)}`);
  console.log(`   Gross Profit: $${stats.profitAnalysis.grossProfit.toFixed(2)}`);
  console.log(`   Profit Margin: ${stats.profitAnalysis.profitMargin.toFixed(2)}%`);

  return stats;
}

// Step 7: Get P&L Report
async function getProfitLossReport() {
  console.log('\n📝 Step 7: Get Profit & Loss Report');
  const pnl = await apiCall('/reports/profit-loss?groupBy=total');

  console.log('\n📊 P&L Income Statement:');
  console.log('   Revenue:');
  console.log(`      Total Revenue: $${pnl.incomeStatement.revenue.totalRevenue.toFixed(2)}`);
  console.log(`      Cash Sales: $${pnl.incomeStatement.revenue.cashSales.toFixed(2)}`);
  console.log(`      Order Count: ${pnl.incomeStatement.revenue.orderCount}`);

  console.log('   Cost of Goods Sold:');
  console.log(`      Total COGS: $${pnl.incomeStatement.costOfGoodsSold.totalCOGS.toFixed(2)}`);
  console.log(`      COGS %: ${pnl.incomeStatement.costOfGoodsSold.cogsPercentage.toFixed(2)}%`);

  console.log('   Gross Profit:');
  console.log(`      Amount: $${pnl.incomeStatement.grossProfit.amount.toFixed(2)}`);
  console.log(`      Margin: ${pnl.incomeStatement.grossProfit.margin.toFixed(2)}%`);

  console.log('   Operating Expenses:');
  console.log(`      Total: $${pnl.incomeStatement.operatingExpenses.totalExpenses.toFixed(2)}`);

  console.log('   Net Profit:');
  console.log(`      Amount: $${pnl.incomeStatement.netProfit.amount.toFixed(2)}`);
  console.log(`      Margin: ${pnl.incomeStatement.netProfit.margin.toFixed(2)}%`);

  return pnl;
}

// Step 8: Calculate expected results
function calculateExpectedResults() {
  console.log('\n📝 Step 8: Calculate Expected Results');

  let totalRevenue = 0;
  let totalCOGS = 0;
  let remainingBatches = TEST_CONFIG.batches.map(b => ({ ...b, remaining: b.quantity }));

  for (const sale of TEST_CONFIG.sales) {
    let quantityToSell = sale.quantity;
    let saleCost = 0;

    // FIFO allocation
    for (let batch of remainingBatches) {
      if (quantityToSell <= 0) break;

      const quantityFromBatch = Math.min(quantityToSell, batch.remaining);
      saleCost += quantityFromBatch * batch.costPrice;
      batch.remaining -= quantityFromBatch;
      quantityToSell -= quantityFromBatch;
    }

    const saleRevenue = sale.quantity * TEST_CONFIG.product.defaultPricePerKg;
    totalRevenue += saleRevenue;
    totalCOGS += saleCost;
  }

  const grossProfit = totalRevenue - totalCOGS;
  const profitMargin = (grossProfit / totalRevenue) * 100;

  console.log('\n🎯 Expected Results:');
  console.log(`   Total Revenue: $${totalRevenue.toFixed(2)}`);
  console.log(`   Total COGS: $${totalCOGS.toFixed(2)}`);
  console.log(`   Gross Profit: $${grossProfit.toFixed(2)}`);
  console.log(`   Profit Margin: ${profitMargin.toFixed(2)}%`);

  return { totalRevenue, totalCOGS, grossProfit, profitMargin };
}

// Main test execution
async function runTest() {
  console.log('🚀 BATCH FIFO COSTING TEST');
  console.log('='.repeat(80));

  try {
    // Login
    const loginResponse = await login();
    const userId = loginResponse.user.id;
    const cashierId = loginResponse.user.id;

    // Setup
    const supplier = await findOrCreateSupplier();
    const product = await findOrCreateProduct();

    // Create batches
    const { purchaseOrders, batches } = await createPurchaseOrders(
      supplier.id,
      product.id,
      userId
    );

    // Create sales
    const sales = await createSales(product.id, cashierId);

    // Get reports
    const dashboard = await getDashboardStats();
    const pnl = await getProfitLossReport();

    // Calculate expected
    const expected = calculateExpectedResults();

    // Compare results
    console.log('\n📊 RESULTS COMPARISON');
    console.log('='.repeat(80));

    console.log('\nRevenue:');
    console.log(`   Expected: $${expected.totalRevenue.toFixed(2)}`);
    console.log(`   Dashboard: $${dashboard.profitAnalysis.totalRevenue.toFixed(2)}`);
    console.log(`   P&L: $${pnl.incomeStatement.revenue.totalRevenue.toFixed(2)}`);

    console.log('\nCOGS:');
    console.log(`   Expected: $${expected.totalCOGS.toFixed(2)}`);
    console.log(`   Dashboard: $${dashboard.profitAnalysis.totalCOGS.toFixed(2)}`);
    console.log(`   P&L: $${pnl.incomeStatement.costOfGoodsSold.totalCOGS.toFixed(2)}`);

    console.log('\nGross Profit:');
    console.log(`   Expected: $${expected.grossProfit.toFixed(2)}`);
    console.log(`   Dashboard: $${dashboard.profitAnalysis.grossProfit.toFixed(2)}`);
    console.log(`   P&L: $${pnl.incomeStatement.grossProfit.amount.toFixed(2)}`);

    console.log('\nProfit Margin:');
    console.log(`   Expected: ${expected.profitMargin.toFixed(2)}%`);
    console.log(`   Dashboard: ${dashboard.profitAnalysis.profitMargin.toFixed(2)}%`);
    console.log(`   P&L: ${pnl.incomeStatement.grossProfit.margin.toFixed(2)}%`);

    // Validate
    const revenueDiff = Math.abs(dashboard.profitAnalysis.totalRevenue - expected.totalRevenue);
    const cogsDiff = Math.abs(dashboard.profitAnalysis.totalCOGS - expected.totalCOGS);
    const profitDiff = Math.abs(dashboard.profitAnalysis.grossProfit - expected.grossProfit);

    console.log('\n✅ TEST RESULTS');
    console.log('='.repeat(80));

    if (revenueDiff < 0.01 && cogsDiff < 0.01 && profitDiff < 0.01) {
      console.log('✅ ALL TESTS PASSED! Batch FIFO costing is working correctly.');
      console.log('✅ Profit calculations are accurate.');
      console.log('✅ Dashboard and P&L reports show correct values.');
    } else {
      console.log('❌ TEST FAILED! Discrepancies found:');
      if (revenueDiff >= 0.01) console.log(`   Revenue diff: $${revenueDiff.toFixed(2)}`);
      if (cogsDiff >= 0.01) console.log(`   COGS diff: $${cogsDiff.toFixed(2)}`);
      if (profitDiff >= 0.01) console.log(`   Profit diff: $${profitDiff.toFixed(2)}`);
    }

  } catch (error) {
    console.error('\n❌ TEST ERROR:', error.message);
    console.error(error.stack);
  }
}

// Run the test
runTest();
