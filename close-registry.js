const API_BASE_URL = 'http://localhost:3001/api';

async function closeRegistry() {
  try {
    // Login as admin
    const loginRes = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@pos.com', password: 'admin123' })
    });
    const { token, user } = await loginRes.json();

    // Get current session
    const sessionRes = await fetch(`${API_BASE_URL}/registry-sessions/current`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const session = await sessionRes.json();

    if (session && session.id) {
      // First, reject any pending refunds
      const refundsRes = await fetch(`${API_BASE_URL}/refunds`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const refundsData = await refundsRes.json();

      if (refundsData.refunds) {
        for (const refund of refundsData.refunds) {
          if (refund.status === 'pending') {
            console.log(`Rejecting pending refund: ${refund.refundNumber}`);
            await fetch(`${API_BASE_URL}/refunds?id=${refund.id}`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
              },
              body: JSON.stringify({
                status: 'rejected',
                approvedBy: user.id,
                rejectReason: 'Cleanup for test'
              })
            });
          }
        }
      }

      // Close the session
      const closeRes = await fetch(`${API_BASE_URL}/registry-sessions?id=${session.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          closedBy: user.id,
          actualCash: session.openingCash,
          status: 'closed',
          closingNotes: 'Cleanup for test'
        })
      });
      const result = await closeRes.json();
      console.log('✅ Registry closed:', result.sessionNumber || result.error);
    } else {
      console.log('ℹ️  No open registry session');
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

closeRegistry();
