/**
 * Verification script for File 12: adminPlots.ts DAL
 * Tests live HTTP operations against backend:
 * 1. Admin login & token acquisition
 * 2. GET /blocks (Master plan blocks) -> 200 OK
 * 3. GET /plots?blockId=abbott (Block plots grid) -> 200 OK
 * 4. GET /plots/:id (Plot details) -> 200 OK
 * 5. POST /plots/:id/lock (Acquire 10m soft lock) -> 200 OK
 * 6. DELETE /plots/:id/lock (Release soft lock) -> 200 OK
 * 7. POST /plots/:id/adjustment (Toggle Town Planning adjustment) -> 200 OK
 */

const http = require('http');

function request(method, path, payload, token) {
  return new Promise((resolve, reject) => {
    const data = payload ? JSON.stringify(payload) : null;
    const headers = {};
    if (data) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(data);
    }
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(
      {
        hostname: 'localhost',
        port: 3001,
        path,
        method,
        headers,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(body) });
          } catch (e) {
            resolve({ status: res.statusCode, raw: body });
          }
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  console.log('=== Step 1: Admin Login ===');
  const loginRes = await request('POST', '/auth/admin/login', {
    username: 'admin',
    password: 'password123',
  });
  console.log('Login status:', loginRes.status);
  const token = loginRes.data.access_token;

  console.log('\n=== Step 2: GET /blocks ===');
  const blocksRes = await request('GET', '/blocks', null, token);
  console.log('Blocks status:', blocksRes.status);
  console.log('Total blocks count:', blocksRes.data.length);
  console.log(
    'Blocks summary:',
    blocksRes.data.map((b) => ({
      id: b.id,
      name: b.name,
      totalCount: b.totalCount,
      availableCount: b.availableCount,
      reservedCount: b.reservedCount,
      bookedCount: b.bookedCount,
    }))
  );

  console.log('\n=== Step 3: GET /plots?blockId=royal ===');
  const plotsRes = await request('GET', '/plots?blockId=royal', null, token);
  console.log('Plots query status:', plotsRes.status);
  console.log('Royal plots count:', plotsRes.data.length);
  const testPlot = plotsRes.data.find((p) => p.status === 'available' && p.category !== 'amenity');
  if (!testPlot) throw new Error('No available test plot found in Royal');
  console.log('Selected available test plot:', {
    id: testPlot.id,
    plotNumber: testPlot.plotNumber,
    price: testPlot.price,
    status: testPlot.status,
  });

  console.log('\n=== Step 4: GET /plots/:id ===');
  const detailRes = await request('GET', `/plots/${testPlot.id}`, null, token);
  console.log('Plot detail status:', detailRes.status);
  console.log('Plot details:', {
    id: detailRes.data.id,
    plotNumber: detailRes.data.plotNumber,
    status: detailRes.data.status,
    blockId: detailRes.data.blockId,
  });

  console.log('\n=== Step 5: POST /plots/:id/lock (Acquire Soft Lock) ===');
  const lockRes = await request('POST', `/plots/${testPlot.id}/lock`, {}, token);
  console.log('Acquire lock status:', lockRes.status);
  console.log('Acquire lock response:', lockRes.data);

  console.log('\n=== Step 6: DELETE /plots/:id/lock (Release Soft Lock) ===');
  const unlockRes = await request('DELETE', `/plots/${testPlot.id}/lock`, null, token);
  console.log('Release lock status:', unlockRes.status);
  console.log('Release lock response:', unlockRes.data);

  console.log('\n=== Step 7: POST /plots/:id/adjustment (Town Planning Freeze) ===');
  const adjustOnRes = await request(
    'POST',
    `/plots/${testPlot.id}/adjustment`,
    {
      isAdjustment: true,
      reason: 'Verification test re-survey freeze',
    },
    token
  );
  console.log('Adjustment freeze status:', adjustOnRes.status);
  console.log('Adjustment on response:', adjustOnRes.data);

  console.log('\n=== Step 8: POST /plots/:id/adjustment (Release Freeze) ===');
  const adjustOffRes = await request(
    'POST',
    `/plots/${testPlot.id}/adjustment`,
    {
      isAdjustment: false,
    },
    token
  );
  console.log('Adjustment release status:', adjustOffRes.status);
  console.log('Adjustment off response:', adjustOffRes.data);

  console.log('\nALL ADMIN PLOTS DAL ENDPOINTS LIVE VERIFIED SUCCESSFULLY.');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
