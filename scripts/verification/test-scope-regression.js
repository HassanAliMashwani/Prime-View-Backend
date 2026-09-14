/**
 * test-scope-regression.js
 * Security Regression Test for Two-Check Permission Model on POST /plots/:id/book
 *
 * 1. Log in as Sub-Admin `police` (assigned to overseas, elite, chalet; NOT abbott).
 * 2. Attempt POST /plots/plot-a-01/book (Abbott block).
 * 3. Verify HTTP 403 Forbidden with OUT_OF_SCOPE typed error.
 * 4. Print raw request and response details.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const { initEnv } = require('./env-helper');
const env = initEnv();
const PORT = env.PORT;

const BASE_URL = `http://localhost:${env.PORT}`;

function httpRequest(options, body = null) {
  return new Promise((resolve) => {
    const reqOptions = {
      hostname: 'localhost',
      port: PORT,
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

async function runTest() {
  console.log('========================================================================');
  console.log(' SECURITY REGRESSION CHECK: OUT-OF-SCOPE SUB-ADMIN BOOKING ATTEMPT');
  console.log('========================================================================\n');

  // 1. Login as police
  console.log('[Step 1] Authenticating Sub-Admin "police" (assigned: overseas, elite, chalet)...');
  const loginRes = await httpRequest({
    path: '/auth/admin/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, {
    username: 'police',
    password: process.env.TEST_ADMIN_PASSWORD || 'password123',
  });

  if (loginRes.statusCode !== 200 && loginRes.statusCode !== 201) {
    throw new Error(`Login failed for police: ${JSON.stringify(loginRes)}`);
  }

  const token = loginRes.body.access_token;
  console.log('[Step 1] "police" successfully authenticated.');
  console.log('Admin Profile payload from token/login:', JSON.stringify(loginRes.body.user || loginRes.body.admin || loginRes.body, null, 2));

  // 2. Target Plot in Abbott Block (plot-a-01, plot-a-02, plot-a-03, plot-a-04, plot-a-05)
  const targetPlotId = 'plot-a-05';
  console.log(`\n[Step 2] Target Plot: ${targetPlotId} (Block: "abbott")`);
  console.log('Sub-Admin "police" assigned blocks do NOT include "abbott".');

  const requestPayload = {
    paymentType: 'one_time',
    customer: {
      fullName: 'Unauthorized Booking Attempt Buyer',
      email: `unauth.buyer.${Date.now()}@example.com`,
      phone: '+923009998877',
      cnic: '37405-9999999-1',
    },
  };

  console.log('\n[Step 3] Firing POST /plots/' + targetPlotId + '/book with police token...');
  console.log('REQUEST:');
  console.log('  URL: POST http://localhost:' + PORT + '/plots/' + targetPlotId + '/book');
  console.log('  Headers:', JSON.stringify({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token.substring(0, 20)}...[REDACTED]`,
  }, null, 2));
  console.log('  Body:', JSON.stringify(requestPayload, null, 2));

  const bookRes = await httpRequest({
    path: `/plots/${targetPlotId}/book`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
  }, requestPayload);

  console.log('\nRESPONSE:');
  console.log('  Status Code:', bookRes.statusCode);
  console.log('  Headers:', JSON.stringify(bookRes.headers, null, 2));
  console.log('  Body:', JSON.stringify(bookRes.body, null, 2));

  // Assertions
  console.log('\n--- Assertion Checks ---');
  const isStatus403 = bookRes.statusCode === 403;
  const isOutOfScope = bookRes.body?.error === 'OUT_OF_SCOPE' || bookRes.body?.reason === 'OUT_OF_SCOPE';

  console.log(`Status == 403 Forbidden: ${isStatus403 ? 'PASS' : 'FAIL'}`);
  console.log(`Error == 'OUT_OF_SCOPE':  ${isOutOfScope ? 'PASS' : 'FAIL'}`);

  if (!isStatus403 || !isOutOfScope) {
    console.error('\n[REGRESSION DETECTED]: Request was NOT rejected with 403 OUT_OF_SCOPE!');
    process.exit(1);
  }

  console.log('\n>>> SECURITY REGRESSION CHECK PASSED: Two-check permission model strictly verified.');
}

runTest().catch((err) => {
  console.error('\n[FATAL ERROR]:', err);
  process.exit(1);
});
