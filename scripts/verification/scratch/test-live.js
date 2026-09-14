const baseUrl = 'http://localhost:3001';

async function testLive() {
  const loginRes = await fetch(`${baseUrl}/auth/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin_royal', password: 'password123' })
  });
  const loginData = await loginRes.json();
  const token = loginData.access_token;
  
  console.log('--- Request ---');
  console.log(`GET /plots`);
  console.log(`Authorization: Bearer ${token.substring(0, 20)}...`);

  const res = await fetch(`${baseUrl}/plots`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  console.log('\n--- Response for /plots ---');
  console.log(`Status: ${res.status}`);

  console.log('\n--- Request ---');
  console.log(`GET /customers`);
  const custRes = await fetch(`${baseUrl}/customers`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  console.log('\n--- Response for /customers ---');
  console.log(`Status: ${custRes.status}`);
  console.log(JSON.stringify(await custRes.json(), null, 2));
}
testLive().catch(console.error);
