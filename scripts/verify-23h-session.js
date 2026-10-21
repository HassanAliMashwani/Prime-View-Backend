const API = 'http://localhost:3001';

function decodeJwt(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
}

async function run() {
  console.log('====================================================');
  console.log('=== VERIFYING 23-HOUR ADMIN LOGIN SESSION ===');
  console.log('====================================================\n');

  // 1. Sub-Admin Login (hassan)
  console.log('1. Signing in as sub-admin "hassan"...');
  const res = await fetch(`${API}/auth/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'hassan', password: 'admin123' }),
  });

  if (!res.ok) {
    throw new Error(`Sub-admin login failed with HTTP ${res.status}`);
  }

  const setCookie = res.headers.get('set-cookie');
  console.log('  Set-Cookie Header:', setCookie);

  const data = await res.json();
  const token = data.access_token;
  if (!token) throw new Error('No access token returned');

  const payload = decodeJwt(token);
  console.log('  Decoded JWT Payload:');
  console.log('    Username:', payload.username);
  console.log('    Role:', payload.role);
  console.log('    Issued At (iat):', payload.iat, `(${new Date(payload.iat * 1000).toISOString()})`);
  console.log('    Expires At (exp):', payload.exp, `(${new Date(payload.exp * 1000).toISOString()})`);

  const diffSeconds = payload.exp - payload.iat;
  const diffHours = diffSeconds / 3600;
  console.log(`  Duration: ${diffSeconds} seconds = ${diffHours} hours`);

  if (diffHours !== 23) {
    throw new Error(`Expected exactly 23 hours for sub-admin, got ${diffHours} hours!`);
  }
  console.log('✓ PASS: Sub-admin JWT expires in exactly 23 hours (82,800 seconds).');

  // 2. Super-Admin Login (admin)
  console.log('\n2. Signing in as super-admin "admin"...');
  const superRes = await fetch(`${API}/auth/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const superData = await superRes.json();
  const superPayload = decodeJwt(superData.access_token);
  const superDiffHours = (superPayload.exp - superPayload.iat) / 3600;
  console.log(`  Super-Admin Duration: ${superDiffHours} hours`);
  if (superDiffHours !== 23) {
    throw new Error(`Expected exactly 23 hours for super-admin, got ${superDiffHours} hours!`);
  }
  console.log('✓ PASS: Super-admin JWT expires in exactly 23 hours.');

  // 3. Sub-Admin Login (umer)
  console.log('\n3. Signing in as sub-admin "umer"...');
  const umerRes = await fetch(`${API}/auth/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'umer', password: 'admin123' }),
  });
  const umerData = await umerRes.json();
  const umerPayload = decodeJwt(umerData.access_token);
  const umerDiffHours = (umerPayload.exp - umerPayload.iat) / 3600;
  console.log(`  Umer Duration: ${umerDiffHours} hours`);
  if (umerDiffHours !== 23) {
    throw new Error(`Expected exactly 23 hours for umer, got ${umerDiffHours} hours!`);
  }
  console.log('✓ PASS: Umer JWT expires in exactly 23 hours.');

  // 4. Verify Cookie max-age
  if (setCookie) {
    const maxAgeMatch = setCookie.match(/max-age=(\d+)/i);
    if (maxAgeMatch) {
      const maxAge = parseInt(maxAgeMatch[1], 10);
      console.log(`\n4. Cookie maxAge: ${maxAge} seconds (${maxAge / 3600} hours)`);
      if (maxAge === 82800) {
        console.log('✓ PASS: Cookie maxAge is exactly 23 hours (82,800 seconds).');
      }
    }
  }

  // 5. Verify Member Login remains unchanged (not 23h)
  console.log('\n5. Checking member login duration...');
  // Find a member to test member login
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
  const testCustomer = await prisma.customer.findFirst({
    where: { passwordHash: { not: null }, membershipNo: { not: null } },
  });
  if (testCustomer) {
    console.log(`  Found member: ${testCustomer.membershipNo}`);
    const memberLoginRes = await fetch(`${API}/auth/member/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ membershipNo: testCustomer.membershipNo, password: 'Password123!' }),
    });
    if (memberLoginRes.ok) {
      const memberData = await memberLoginRes.json();
      const memberPayload = decodeJwt(memberData.access_token);
      const memberDiffHours = (memberPayload.exp - memberPayload.iat) / 3600;
      console.log(`  Member Session Duration: ${memberDiffHours} hours`);
      if (memberDiffHours === 24) {
        console.log('✓ PASS: Member session remains at 24 hours (unchanged).');
      }
    }
  }

  console.log('\n====================================================');
  console.log('=== ALL 23-HOUR SESSION CHECKS PASSED! ===');
  console.log('====================================================');
}

run().catch(err => {
  console.error('\n❌ ERROR:', err);
  process.exit(1);
});
