const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // 1. Check a plot in abbott block
  const plots = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_role', 'super_admin', true)`;
    return tx.plot.findMany({
      where: { blockId: 'abbott' },
      take: 2,
      select: { id: true, blockId: true, plotNumber: true }
    });
  });
  console.log('Abbott plots in DB:', plots);

  // 2. Login as admin_royal (assigned ONLY to 'royal' block)
  const loginRoyal = await fetch('http://localhost:3001/auth/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin_royal', password: 'password123' })
  });
  const royalData = await loginRoyal.json();
  console.log('Login admin_royal status:', loginRoyal.status, 'Has token:', !!royalData.access_token);

  // 3. Login as marketing (assigned to ['abbott', 'royal'])
  const loginMkt = await fetch('http://localhost:3001/auth/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'marketing', password: 'password123' })
  });
  const mktData = await loginMkt.json();
  console.log('Login marketing status:', loginMkt.status, 'Has token:', !!mktData.access_token);

  const plotId = plots[0].id;
  console.log(`\nTesting GET /plots/${plotId} (Block: ${plots[0].blockId})`);

  // 4. Marketing (in scope for abbott) requests the plot
  const resMkt = await fetch(`http://localhost:3001/plots/${plotId}`, {
    headers: { 'Authorization': `Bearer ${mktData.access_token}` }
  });
  console.log('Marketing (assigned to abbott) status:', resMkt.status);
  const mktBody = await resMkt.json();
  console.log('Marketing response plotNumber:', mktBody.plotNumber, 'blockId:', mktBody.blockId);

  // 5. Admin Royal (OUT of scope, assigned ONLY to royal) requests the abbott plot
  const resRoyal = await fetch(`http://localhost:3001/plots/${plotId}`, {
    headers: { 'Authorization': `Bearer ${royalData.access_token}` }
  });
  console.log('\nAdmin Royal (assigned ONLY to royal, requesting abbott plot) status:', resRoyal.status);
  const royalBody = await resRoyal.json();
  console.log('Admin Royal response body:', royalBody);
}

main().catch(console.error).finally(() => prisma.$disconnect());
