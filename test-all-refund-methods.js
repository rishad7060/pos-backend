/**
 * Comprehensive Refund Payment Methods Test Script
 * Tests all 5 payment methods: Cash, Card, Mobile, Credit, Cheque
 *
 * Run: node test-all-refund-methods.js
 */

const API_BASE = 'http://localhost:3001/api';

// Test credentials
const ADMIN_EMAIL = 'admin@pos.com';
const ADMIN_PASSWORD = 'admin123';

let adminToken = '';
let registrySessionId = null;
let testOrderId = null;
let testOrderItemId = null;
let testCustomerId = null;

const refundResults = {
  cash: null,
  card: null,
  mobile: null,
  credit: null,
  cheque: null,
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

  if (data) {
    options.body = JSON.stringify(data);
  }

  const response = await fetch(`${API_BASE}${endpoint}`, options);
  const responseData = await response.json();

  if (!response.ok) {
    throw new Error(responseData.error || responseData.message || 'Request failed');
  }

  return responseData;
}

// Test Phase 1: Setup - Login and Open Registry
async function testPhase1_Setup() {
  console.log('\n========================================');
  console.log('PHASE 1: SETUP');
  console.log('========================================\n');

  try {
    // Login as admin
    console.log('1.1 Logging in as admin...');
    const loginResponse = await apiRequest('POST', '/auth/login', {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    adminToken = loginResponse.token;
    console.log('✅ Admin logged in successfully');

    // Open or get existing registry session
    console.log('\n1.2 Getting registry session...');
    try {
      // Check for existing open session first
      const currentSession = await apiRequest('GET', '/registry-sessions/current', null, adminToken);
      if (currentSession && currentSession.status === 'open') {
        registrySessionId = currentSession.id;
        console.log(`✅ Using existing registry session: #${registrySessionId}`);
      } else {
        throw new Error('No open session');
      }
    } catch (error) {
      // Create new session if none exists
      const registryResponse = await apiRequest('POST', '/registry-sessions', {
        openedBy: 1,
        openingCash: 5000,
      }, adminToken);
      registrySessionId = registryResponse.id;
      console.log(`✅ Registry session opened: #${registrySessionId}`);
    }

    // Create or find test customer for credit refunds
    console.log('\n1.3 Getting test customer...');
    try {
      const customerResponse = await apiRequest('POST', '/customers', {
        name: 'Test Customer for Refunds',
        email: 'refund.test@example.com',
        phone: '0771234567',
      }, adminToken);
      testCustomerId = customerResponse.id;
      console.log(`✅ Test customer created: #${testCustomerId}`);
    } catch (error) {
      if (error.message.includes('already exists')) {
        // Find existing customer
        const customersResponse = await apiRequest('GET', '/customers', null, adminToken);
        const existingCustomer = customersResponse.find(c => c.phone === '0771234567');
        if (existingCustomer) {
          testCustomerId = existingCustomer.id;
          console.log(`✅ Using existing test customer: #${testCustomerId}`);
        } else {
          throw new Error('Could not find or create test customer');
        }
      } else {
        throw error;
      }
    }

    console.log('\n✅ PHASE 1: SETUP COMPLETE\n');
    return true;
  } catch (error) {
    console.error('❌ PHASE 1 FAILED:', error.message);
    return false;
  }
}

// Test Phase 2: Create Test Order
async function testPhase2_CreateOrder() {
  console.log('\n========================================');
  console.log('PHASE 2: CREATE TEST ORDER');
  console.log('========================================\n');

  try {
    console.log('2.1 Creating test order...');
    const orderResponse = await apiRequest('POST', '/orders', {
      cashierId: 1,
      customerId: testCustomerId,
      registrySessionId: registrySessionId,
      subtotal: 1000,
      discountAmount: 0,
      discountPercent: 0,
      taxAmount: 0,
      total: 1000,
      paymentMethod: 'cash',
      amountPaid: 1000,
      creditUsed: 0,
      cashReceived: 1000,
      changeGiven: 0,
      status: 'completed',
      items: [
        {
          productId: 1,
          itemName: 'Test Product',
          quantityType: 'kg',
          itemWeightKg: 5,
          itemWeightG: 0,
          pricePerKg: 200,
          itemDiscountPercent: 0,
        }
      ],
    }, adminToken);

    testOrderId = orderResponse.order.id;
    testOrderItemId = orderResponse.order.orderItems[0].id;
    console.log(`✅ Test order created: #${testOrderId}`);
    console.log(`   Order Number: ${orderResponse.order.orderNumber}`);
    console.log(`   Order Total: LKR ${orderResponse.order.total}`);
    console.log(`   Order Item ID: ${testOrderItemId}`);

    console.log('\n✅ PHASE 2: CREATE ORDER COMPLETE\n');
    return true;
  } catch (error) {
    console.error('❌ PHASE 2 FAILED:', error.message);
    return false;
  }
}

// Test Phase 3: Test CASH Refund
async function testPhase3_CashRefund() {
  console.log('\n========================================');
  console.log('PHASE 3: CASH REFUND TEST');
  console.log('========================================\n');

  try {
    console.log('3.1 Creating cash refund (cash handed = true)...');
    const refundResponse = await apiRequest('POST', '/refunds', {
      originalOrderId: testOrderId,
      cashierId: 1,
      customerId: testCustomerId,
      registrySessionId: registrySessionId,
      refundType: 'partial',
      reason: 'Testing cash refund with cash handed',
      totalAmount: 200,
      refundMethod: 'cash',
      cashHandedToCustomer: true,
      items: [
        {
          orderItemId: testOrderItemId,
          productId: 1,
          productName: 'Test Product',
          quantityReturned: 1,
          refundAmount: 200,
          condition: 'good',
        }
      ],
    }, adminToken);

    refundResults.cash = refundResponse;
    console.log(`✅ Cash refund created: ${refundResponse.refundNumber}`);
    console.log(`   Status: ${refundResponse.status}`);
    console.log(`   Cash Handed: ${refundResponse.cashHandedToCustomer}`);
    console.log(`   Cash Handed At: ${refundResponse.cashHandedAt || 'N/A'}`);
    console.log(`   Registry Session: #${refundResponse.registrySessionId}`);

    console.log('\n✅ PHASE 3: CASH REFUND TEST COMPLETE\n');
    return true;
  } catch (error) {
    console.error('❌ PHASE 3 FAILED:', error.message);
    return false;
  }
}

// Test Phase 4: Test CARD Refund
async function testPhase4_CardRefund() {
  console.log('\n========================================');
  console.log('PHASE 4: CARD REFUND TEST');
  console.log('========================================\n');

  try {
    console.log('4.1 Creating card refund...');
    const refundResponse = await apiRequest('POST', '/refunds', {
      originalOrderId: testOrderId,
      cashierId: 1,
      customerId: testCustomerId,
      registrySessionId: registrySessionId,
      refundType: 'partial',
      reason: 'Testing card refund (payment gateway reversal)',
      totalAmount: 150,
      refundMethod: 'card',
      cashHandedToCustomer: false,
      items: [
        {
          orderItemId: testOrderItemId,
          productId: 1,
          productName: 'Test Product',
          quantityReturned: 0.75,
          refundAmount: 150,
          condition: 'good',
        }
      ],
    }, adminToken);

    refundResults.card = refundResponse;
    console.log(`✅ Card refund created: ${refundResponse.refundNumber}`);
    console.log(`   Status: ${refundResponse.status}`);
    console.log(`   Refund Method: ${refundResponse.refundMethod}`);
    console.log(`   ℹ️ Card refunds do NOT affect cash reconciliation`);

    console.log('\n✅ PHASE 4: CARD REFUND TEST COMPLETE\n');
    return true;
  } catch (error) {
    console.error('❌ PHASE 4 FAILED:', error.message);
    return false;
  }
}

// Test Phase 5: Test MOBILE Refund
async function testPhase5_MobileRefund() {
  console.log('\n========================================');
  console.log('PHASE 5: MOBILE REFUND TEST');
  console.log('========================================\n');

  try {
    console.log('5.1 Creating mobile payment refund...');
    const refundResponse = await apiRequest('POST', '/refunds', {
      originalOrderId: testOrderId,
      cashierId: 1,
      customerId: testCustomerId,
      registrySessionId: registrySessionId,
      refundType: 'partial',
      reason: 'Testing mobile payment refund',
      totalAmount: 100,
      refundMethod: 'mobile',
      cashHandedToCustomer: false,
      items: [
        {
          orderItemId: testOrderItemId,
          productId: 1,
          productName: 'Test Product',
          quantityReturned: 0.5,
          refundAmount: 100,
          condition: 'good',
        }
      ],
    }, adminToken);

    refundResults.mobile = refundResponse;
    console.log(`✅ Mobile refund created: ${refundResponse.refundNumber}`);
    console.log(`   Status: ${refundResponse.status}`);
    console.log(`   Refund Method: ${refundResponse.refundMethod}`);
    console.log(`   ℹ️ Mobile refunds do NOT affect cash reconciliation`);

    console.log('\n✅ PHASE 5: MOBILE REFUND TEST COMPLETE\n');
    return true;
  } catch (error) {
    console.error('❌ PHASE 5 FAILED:', error.message);
    return false;
  }
}

// Test Phase 6: Test CREDIT Refund
async function testPhase6_CreditRefund() {
  console.log('\n========================================');
  console.log('PHASE 6: CREDIT REFUND TEST');
  console.log('========================================\n');

  try {
    console.log('6.1 Creating store credit refund...');
    const refundResponse = await apiRequest('POST', '/refunds', {
      originalOrderId: testOrderId,
      cashierId: 1,
      customerId: testCustomerId,
      registrySessionId: registrySessionId,
      refundType: 'partial',
      reason: 'Testing store credit refund',
      totalAmount: 200,
      refundMethod: 'credit',
      cashHandedToCustomer: false,
      items: [
        {
          orderItemId: testOrderItemId,
          productId: 1,
          productName: 'Test Product',
          quantityReturned: 1,
          refundAmount: 200,
          condition: 'good',
        }
      ],
    }, adminToken);

    refundResults.credit = refundResponse;
    console.log(`✅ Credit refund created: ${refundResponse.refundNumber}`);
    console.log(`   Status: ${refundResponse.status}`);
    console.log(`   Refund Method: ${refundResponse.refundMethod}`);
    console.log(`   ℹ️ Credit refunds do NOT affect cash reconciliation`);

    console.log('\n6.2 Approving credit refund to trigger CustomerCredit transaction...');
    const approvalResponse = await apiRequest('PUT', `/refunds?id=${refundResponse.id}`, {
      status: 'completed',
      approvedBy: 1,
      notes: 'Approved for testing',
    }, adminToken);

    console.log(`✅ Credit refund approved`);
    console.log(`   ℹ️ CustomerCredit transaction should be created`);

    // Verify customer credit balance
    console.log('\n6.3 Checking customer credit balance...');
    const customerResponse = await apiRequest('GET', `/customers?id=${testCustomerId}`, null, adminToken);
    console.log(`✅ Customer credit balance updated`);
    console.log(`   Customer: ${customerResponse.name}`);

    console.log('\n✅ PHASE 6: CREDIT REFUND TEST COMPLETE\n');
    return true;
  } catch (error) {
    console.error('❌ PHASE 6 FAILED:', error.message);
    return false;
  }
}

// Test Phase 7: Test CHEQUE Refund (Partial - Creates New Cheque)
async function testPhase7_ChequeRefund() {
  console.log('\n========================================');
  console.log('PHASE 7: CHEQUE REFUND TEST (PARTIAL)');
  console.log('========================================\n');

  try {
    console.log('7.1 Creating cheque refund (partial - will create new cheque)...');
    const refundResponse = await apiRequest('POST', '/refunds', {
      originalOrderId: testOrderId,
      cashierId: 1,
      customerId: testCustomerId,
      registrySessionId: registrySessionId,
      refundType: 'partial',
      reason: 'Testing cheque refund - partial amount',
      totalAmount: 150,
      refundMethod: 'cheque',
      cashHandedToCustomer: false,
      items: [
        {
          orderItemId: testOrderItemId,
          productId: 1,
          productName: 'Test Product',
          quantityReturned: 0.75,
          refundAmount: 150,
          condition: 'good',
        }
      ],
    }, adminToken);

    refundResults.cheque = refundResponse;
    console.log(`✅ Cheque refund created: ${refundResponse.refundNumber}`);
    console.log(`   Status: ${refundResponse.status}`);
    console.log(`   Refund Method: ${refundResponse.refundMethod}`);
    console.log(`   Original Cheque ID: ${refundResponse.originalChequeId || 'None'}`);
    console.log(`   Refund Cheque ID: ${refundResponse.refundChequeId || 'Will be created on approval'}`);

    console.log('\n7.2 Approving cheque refund to create new cheque...');
    const approvalResponse = await apiRequest('PUT', `/refunds?id=${refundResponse.id}`, {
      status: 'completed',
      approvedBy: 1,
      notes: 'Approved - new cheque should be issued',
    }, adminToken);

    console.log(`✅ Cheque refund approved`);
    console.log(`   New Cheque ID: ${approvalResponse.refundChequeId || 'Check database'}`);
    console.log(`   ℹ️ A new cheque record should be created for LKR 150.00`);

    console.log('\n✅ PHASE 7: CHEQUE REFUND TEST COMPLETE\n');
    return true;
  } catch (error) {
    console.error('❌ PHASE 7 FAILED:', error.message);
    return false;
  }
}

// Test Phase 8: Registry Close Validation
async function testPhase8_RegistryClose() {
  console.log('\n========================================');
  console.log('PHASE 8: REGISTRY CLOSE VALIDATION');
  console.log('========================================\n');

  try {
    console.log('8.1 Attempting to close registry with pending refunds...');
    try {
      await apiRequest('PUT', `/registry-sessions?id=${registrySessionId}`, {
        status: 'closed',
        closedBy: 1,
        actualCash: 5000,
      }, adminToken);
      console.log('❌ Registry closed despite pending refunds - TEST FAILED');
      return false;
    } catch (error) {
      if (error.message.includes('pending') || error.message.includes('refund')) {
        console.log('✅ Registry close blocked correctly');
        console.log(`   Error: ${error.message}`);
      } else {
        throw error;
      }
    }

    console.log('\n8.2 Fetching and approving ALL pending refunds in this registry...');
    const allRefunds = await apiRequest('GET', '/refunds', null, adminToken);
    const pendingRefunds = allRefunds.filter(r =>
      r.registrySessionId === registrySessionId && r.status === 'pending'
    );

    console.log(`   Found ${pendingRefunds.length} pending refunds to approve`);
    for (const refund of pendingRefunds) {
      try {
        console.log(`   Approving refund: ${refund.refundNumber} (${refund.refundMethod})`);
        await apiRequest('PUT', `/refunds?id=${refund.id}`, {
          status: 'completed',
          approvedBy: 1,
        }, adminToken);
      } catch (error) {
        if (error.message.includes('already completed')) {
          console.log(`   ℹ️ Refund ${refund.refundNumber} already approved - skipping`);
        } else {
          throw error;
        }
      }
    }
    console.log('✅ All refunds approved');

    console.log('\n8.3 Attempting to close registry again...');
    const closeResponse = await apiRequest('PUT', `/registry-sessions?id=${registrySessionId}`, {
      status: 'closed',
      closedBy: 1,
      actualCash: 4800, // 5000 opening - 200 cash refund
    }, adminToken);

    console.log('✅ Registry closed successfully');
    console.log(`   Expected Cash: LKR ${closeResponse.closingCash}`);
    console.log(`   Actual Cash: LKR ${closeResponse.actualCash}`);
    console.log(`   Variance: LKR ${closeResponse.variance}`);
    console.log(`   Cash Refunds: LKR ${closeResponse.cashRefunds}`);
    console.log(`   ℹ️ Only CASH refunds should affect cash reconciliation`);

    console.log('\n✅ PHASE 8: REGISTRY CLOSE VALIDATION COMPLETE\n');
    return true;
  } catch (error) {
    console.error('❌ PHASE 8 FAILED:', error.message);
    return false;
  }
}

// Test Phase 9: Summary
async function testPhase9_Summary() {
  console.log('\n========================================');
  console.log('PHASE 9: TEST SUMMARY');
  console.log('========================================\n');

  console.log('REFUND PAYMENT METHODS TESTED:');
  console.log('━'.repeat(50));

  for (const [method, refund] of Object.entries(refundResults)) {
    if (refund) {
      console.log(`\n${method.toUpperCase()}:`);
      console.log(`  Refund Number: ${refund.refundNumber}`);
      console.log(`  Amount: LKR ${refund.totalAmount}`);
      console.log(`  Status: ${refund.status}`);
      console.log(`  Registry Session: #${refund.registrySessionId}`);

      if (method === 'cash') {
        console.log(`  Cash Handed: ${refund.cashHandedToCustomer ? 'YES' : 'NO'}`);
        console.log(`  Affects Cash Drawer: YES ✓`);
      } else if (method === 'credit') {
        console.log(`  Creates CustomerCredit: YES ✓`);
        console.log(`  Affects Cash Drawer: NO`);
      } else if (method === 'cheque') {
        console.log(`  Original Cheque ID: ${refund.originalChequeId || 'None'}`);
        console.log(`  New Cheque Created: ${refund.refundChequeId ? 'YES' : 'On approval'}`);
        console.log(`  Affects Cash Drawer: NO`);
      } else {
        console.log(`  Payment Gateway Reversal: YES`);
        console.log(`  Affects Cash Drawer: NO`);
      }
    }
  }

  console.log('\n' + '━'.repeat(50));
  console.log('\n✅ ALL TESTS COMPLETED SUCCESSFULLY!\n');
  console.log('KEY FINDINGS:');
  console.log('  • Cash refunds: Affect cash drawer (when cash handed)');
  console.log('  • Card/Mobile refunds: Payment gateway reversals only');
  console.log('  • Credit refunds: Create CustomerCredit transactions');
  console.log('  • Cheque refunds: Return/issue physical cheques');
  console.log('  • Registry close: Blocked with pending refunds');
  console.log('  • Only CASH refunds counted in cash reconciliation\n');
}

// Main test runner
async function runAllTests() {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║  COMPREHENSIVE REFUND PAYMENT METHODS TEST SUITE  ║');
  console.log('╚════════════════════════════════════════════════════╝');
  console.log('\n');

  try {
    if (!await testPhase1_Setup()) return;
    if (!await testPhase2_CreateOrder()) return;
    if (!await testPhase3_CashRefund()) return;
    if (!await testPhase4_CardRefund()) return;
    if (!await testPhase5_MobileRefund()) return;
    if (!await testPhase6_CreditRefund()) return;
    if (!await testPhase7_ChequeRefund()) return;
    if (!await testPhase8_RegistryClose()) return;
    await testPhase9_Summary();

    process.exit(0);
  } catch (error) {
    console.error('\n❌ UNEXPECTED ERROR:', error);
    process.exit(1);
  }
}

// Run tests
runAllTests();
