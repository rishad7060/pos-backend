// Quick test script for product deletion
const axios = require('axios');

async function testProductDelete() {
  try {
    console.log('🧪 Testing Product Delete Endpoint...\n');

    // First, get a product to test with
    console.log('1. Fetching products...');
    const productsRes = await axios.get('http://localhost:3001/api/products', {
      headers: {
        'Authorization': 'Bearer YOUR_JWT_TOKEN_HERE' // Replace with actual token
      }
    });

    if (productsRes.data.length === 0) {
      console.log('❌ No products found in database');
      return;
    }

    const testProduct = productsRes.data[0];
    console.log(`✓ Found product: ${testProduct.name} (ID: ${testProduct.id})\n`);

    // Try to delete it
    console.log('2. Attempting to delete product...');
    const deleteRes = await axios.delete(`http://localhost:3001/api/products?id=${testProduct.id}`, {
      headers: {
        'Authorization': 'Bearer YOUR_JWT_TOKEN_HERE' // Replace with actual token
      }
    });

    console.log('✅ Delete Response:', JSON.stringify(deleteRes.data, null, 2));

  } catch (error) {
    console.log('\n❌ Error occurred:');
    if (error.response) {
      console.log('Status:', error.response.status);
      console.log('Error:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.log(error.message);
    }
  }
}

testProductDelete();

// INSTRUCTIONS:
// 1. Replace YOUR_JWT_TOKEN_HERE with your actual JWT token
// 2. Run: node test-delete-product.js
