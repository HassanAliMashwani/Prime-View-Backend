const baseUrl = 'http://localhost:3001';

async function testSuspended() {
  // First suspend the customer
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient({datasources:{db:{url:process.env.DIRECT_URL}}});
  await prisma.customer.update({
    where: { membershipNo: 'PV-2024-001' },
    data: { accountStatus: 'suspended' }
  });
  await prisma.$disconnect();

  const loginRes = await fetch(`${baseUrl}/auth/member/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ membershipNo: 'PV-2024-001', password: 'password123' })
  });
  const data = await loginRes.json();
  console.log(`Status: ${loginRes.status}`);
  console.log(JSON.stringify(data, null, 2));
}

testSuspended().catch(console.error);
