/**
 * VERIFY BATCH COST PRICE AND CHEQUE TRACKING
 *
 * This script verifies:
 * 1. Batch cost price is correctly tracked in order items
 * 2. Cheques appear in financial/accounting reports
 */

const API_BASE = 'http://localhost:3001/api';
const ADMIN_EMAIL = 'admin@pos.com';
const ADMIN_PASSWORD = 'admin123';

let adminToken = '';

// API request helper
async function apiRequest(method, endpoint, data = null, token = '') {
  const url = `${API_BASE}${endpoint}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { 'Authorization': `Bearer ${token}` }),
    },
  };

  if (data && method !== 'GET') {
    options.body = JSON.stringify(data);
  } else if (data && method === 'GET') {
    const params = new URLSearchParams(data);
    return fetch(`${url}?${params}`, options).then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(new Error(e.error || 'Request failed'))));
  }

  const response = await fetch(url, options);
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || `API error: ${response.status}`);
  }

  return result;
}

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║   VERIFY BATCH COST PRICE & CHEQUE TRACKING              ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

async function runVerification() {
  try {
    // 1. Login
    console.log('📍 Logging in...');
    const loginResponse = await apiRequest('POST', '/auth/login', {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    adminToken = loginResponse.token;
    console.log('✅ Logged in successfully\n');

    // 2. Check recent orders for batch cost price
    console.log('📊 VERIFICATION 1: Batch Cost Price Tracking');
    console.log('═'.repeat(60));

    const orders = await apiRequest('GET', '/orders', null, adminToken);
    const recentOrders = orders.slice(0, 5);

    if (recentOrders.length === 0) {
      console.log('⚠️  No orders found - run test-complete-system.js first');
    } else {
      console.log(`Found ${recentOrders.length} recent orders\n`);

      for (const order of recentOrders) {
        const response = await apiRequest('GET', `/orders?id=${order.id}`, null, adminToken);
        const fullOrder = response.order || response;
        const items = response.items || fullOrder.orderItems || [];

        console.log(`Order #${fullOrder.orderNumber || order.orderNumber}:`);
        console.log(`  Total: LKR ${fullOrder.total || order.total}`);

        if (!items || items.length === 0) {
          console.log(`  ⚠️  No order items found`);
          continue;
        }

        console.log(`  Items: ${items.length}`);

        items.forEach((item, index) => {
          console.log(`  Item ${index + 1}: ${item.itemName}`);
          console.log(`    Quantity: ${item.netWeightKg} kg`);
          console.log(`    Price/kg: LKR ${item.pricePerKg}`);
          console.log(`    Cost/kg: LKR ${item.costPrice || 'N/A'} ${item.costPrice ? '✅' : '❌ MISSING'}`);
          console.log(`    Revenue: LKR ${item.finalTotal}`);

          if (item.costPrice) {
            const cost = item.costPrice * item.netWeightKg;
            const profit = item.finalTotal - cost;
            const margin = ((profit / item.finalTotal) * 100).toFixed(2);
            console.log(`    Profit: LKR ${profit.toFixed(2)} (${margin}% margin) ✅`);
          } else {
            console.log(`    ❌ Cannot calculate profit - cost price missing!`);
          }
        });
        console.log('');
      }
    }

    // 3. Check cheques in financial reports
    console.log('\n📊 VERIFICATION 2: Cheque Tracking in Financial Reports');
    console.log('═'.repeat(60));

    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - 30); // Last 30 days

    const plStatement = await apiRequest('GET', '/reports/profit-loss', {
      startDate: startDate.toISOString().split('T')[0],
      endDate: today.toISOString().split('T')[0],
    }, adminToken);

    console.log('\n💰 Profit & Loss Statement (Last 30 Days):');
    console.log('─'.repeat(60));
    console.log(`Revenue: LKR ${plStatement.incomeStatement.revenue.totalRevenue}`);
    console.log(`COGS: LKR ${plStatement.incomeStatement.costOfGoodsSold.totalCOGS}`);
    console.log(`Gross Profit: LKR ${plStatement.incomeStatement.grossProfit.amount} (${plStatement.incomeStatement.grossProfit.margin}%)`);
    console.log(`Expenses: LKR ${plStatement.incomeStatement.operatingExpenses.totalExpenses}`);
    console.log(`Net Profit: LKR ${plStatement.incomeStatement.netProfit.amount} (${plStatement.incomeStatement.netProfit.margin}%)`);

    // Check for cheque tracking
    console.log('\n📋 Cheque Tracking:');
    console.log('─'.repeat(60));

    if (plStatement.chequeTracking) {
      console.log('✅ Cheque tracking is present in P&L statement!');
      console.log(`  Cheques Received: LKR ${plStatement.chequeTracking.received.total}`);
      console.log(`    - Pending: LKR ${plStatement.chequeTracking.received.pending}`);
      console.log(`    - Cleared: LKR ${plStatement.chequeTracking.received.cleared}`);
      console.log(`    - Bounced: LKR ${plStatement.chequeTracking.received.bounced}`);
      console.log(`    - Endorsed: LKR ${plStatement.chequeTracking.received.endorsed}`);
      console.log(`  Cheques Issued: LKR ${plStatement.chequeTracking.issued.total}`);
      console.log(`  Total Cheques: ${plStatement.chequeTracking.count}`);
    } else {
      console.log('❌ Cheque tracking is MISSING from P&L statement!');
    }

    // Summary
    console.log('\n\n╔════════════════════════════════════════════════════════════╗');
    console.log('║                    VERIFICATION SUMMARY                    ║');
    console.log('╚════════════════════════════════════════════════════════════╝');

    // Check if any order has cost price data
    let hasBatchCostPrice = false;
    for (const order of recentOrders) {
      try {
        const response = await apiRequest('GET', `/orders?id=${order.id}`, null, adminToken);
        const items = response.items || response.order?.orderItems || [];
        if (items && items.some(i => i.costPrice)) {
          hasBatchCostPrice = true;
          break;
        }
      } catch (e) {
        // Continue checking other orders
      }
    }

    const hasChequeTracking = plStatement.chequeTracking !== undefined;

    console.log(`\n✅ Batch Cost Price Tracking: ${hasBatchCostPrice ? 'WORKING' : 'NOT WORKING'}`);
    console.log(`✅ Cheque Tracking in Reports: ${hasChequeTracking ? 'WORKING' : 'NOT WORKING'}`);

    if (hasBatchCostPrice && hasChequeTracking) {
      console.log('\n🎉 ALL VERIFICATIONS PASSED!\n');
    } else {
      console.log('\n⚠️  SOME ISSUES FOUND - CHECK OUTPUT ABOVE\n');
    }

  } catch (error) {
    console.error('\n❌ Verification failed:', error.message);
    console.error(error);
  }
}

runVerification();
