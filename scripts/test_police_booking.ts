import 'dotenv/config';
import * as http from 'http';

function httpRequest(options: any, body: any = null): Promise<any> {
  return new Promise((resolve) => {
    const reqOptions = {
      hostname: '::1',
      port: process.env.PORT || 3001,
      path: options.path,
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let parsed = data;
        try { parsed = JSON.parse(data); } catch {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: parsed,
        });
      });
    });

    req.on('error', (err) => resolve({ statusCode: 0, error: err.message }));
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function main() {
  console.log('--- 1. Login as police ---');
  const loginRes = await httpRequest({
    path: '/auth/admin/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, {
    username: 'police',
    password: 'admin123',
  });
  console.log('Login status:', loginRes.statusCode, 'Error:', loginRes.error);
  console.log('Login body:', loginRes.body);

  const token = loginRes.body?.access_token || loginRes.body?.token;
  if (!token) {
    console.error('No token returned');
    return;
  }

  console.log('\n--- 2. Fetch accessible blocks ---');
  const blocksRes = await httpRequest({
    path: '/blocks',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  console.log('Blocks status:', blocksRes.statusCode);
  console.log('Accessible blocks:', blocksRes.body?.map((b: any) => b.id));

  console.log('\n--- 3. Find an available plot in assigned block (elite) with price > 0 ---');
  const plotsRes = await httpRequest({
    path: '/plots?blockId=elite&status=available',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const plot = plotsRes.body?.find((p: any) => p.status === 'available' && Number(p.price) > 0);
  console.log('Found plot:', plot?.id, plot?.plotNumber, plot?.price, plot?.status);
  if (!plot) {
    console.error('No available plot with price > 0 in elite');
    return;
  }

  console.log('\n--- 4. Acquire Lock on plot ---');
  const lockRes = await httpRequest({
    path: `/plots/${plot.id}/lock`,
    method: 'POST',
    headers: { 
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });
  console.log('Lock status:', lockRes.statusCode);
  console.log('Lock body:', lockRes.body);

  console.log('\n--- 5. Minimal Booking on plot ---');
  const minBookRes = await httpRequest({
    path: '/customers/minimal-booking',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  }, {
    plotId: plot.id,
    customerName: 'Police Test Buyer',
    cnic: '37405-1234567-1',
    phone: '+923001234567',
    city: 'Abbottabad'
  });
  console.log('Minimal Booking status:', minBookRes.statusCode);
  console.log('Minimal Booking body:', minBookRes.body);

  console.log('\n--- 6. Regular bookPlot on plot ---');
  const bookRes = await httpRequest({
    path: `/plots/${plot.id}/book`,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  }, {
    customer: {
      fullName: 'Police Test Buyer Regular',
      cnic: '37405-1234567-2',
      phone: '+923001234568',
      email: 'police.buyer@test.pk',
      city: 'Abbottabad'
    },
    payment: {
      paymentPlan: 'full',
      totalAgreedPrice: plot.price,
      downPaymentAmount: plot.price
    }
  });
  console.log('BookPlot status:', bookRes.statusCode);
  console.log('BookPlot body:', bookRes.body);
}

main().catch(console.error);
