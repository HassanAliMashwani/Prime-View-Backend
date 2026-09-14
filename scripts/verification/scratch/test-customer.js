const baseUrl = 'http://localhost:3001';

async function testCustomerEndpoints() {
  const loginRes = await fetch(`${baseUrl}/auth/member/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ membershipNo: 'PV-2024-002', password: 'password123' })
  });
  const loginData = await loginRes.json();
  const token = loginData.access_token;
  
  if (!token) {
    console.log('Login failed:', loginData);
    return;
  }
  
  console.log('--- GET /me/plots ---');
  const plotsRes = await fetch(`${baseUrl}/me/plots`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  console.log(`Status: ${plotsRes.status}`);
  console.log(JSON.stringify(await plotsRes.json(), null, 2));

  console.log('\n--- GET /me/payments ---');
  const paymentsRes = await fetch(`${baseUrl}/me/payments`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  console.log(`Status: ${paymentsRes.status}`);
  console.log(JSON.stringify(await paymentsRes.json(), null, 2));
}
testCustomerEndpoints().catch(console.error);
