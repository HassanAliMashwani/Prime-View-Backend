async function testLockout() {
  console.log('Testing Admin Account Lockout after 5 failed attempts...');
  for (let i = 1; i <= 6; i++) {
    const res = await fetch('http://localhost:3001/auth/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'police', password: 'wrong_password_test' })
    });
    const data = await res.json();
    console.log(`Attempt ${i}: HTTP ${res.status} - ${data.message}`);
  }
}
testLockout().catch(console.error);
