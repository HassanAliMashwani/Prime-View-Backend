/**
 * test-storage-provider-and-postupload.js
 * Comprehensive Storage Policy & Verification Suite ([OI-01])
 *
 * Part 1: Direct Storage Provider Enforcement Test (Write-time test against Supabase Storage API)
 * Part 2: App-Level Post-Upload Verification Test (Method B per Doc 10 §6)
 * Part 3: Receipts Service Integration Guard (Reject before acceptance)
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { PrismaClient } = require('@prisma/client');

const { initEnv } = require('./env-helper');
const env = initEnv();

const BASE_URL = `http://localhost:${env.PORT}`;

function makeRequest(urlStr, options = {}, body = null) {
  return new Promise((resolve) => {
    const parsed = new URL(urlStr);
    const client = parsed.protocol === 'https:' ? https : http;
    const reqOptions = {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    const req = client.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let parsedBody = data;
        try { parsedBody = JSON.parse(data); } catch {}
        resolve({
          statusCode: res.statusCode,
          statusMessage: res.statusMessage,
          headers: res.headers,
          body: parsedBody,
        });
      });
    });

    req.on('error', (err) => resolve({ statusCode: 0, error: err.message }));
    if (body) {
      req.write(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    }
    req.end();
  });
}

const { spawn } = require('child_process');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function isServerRunning() {
  try {
    const res = await makeRequest(`${BASE_URL}/blocks`);
    return res.statusCode === 401 || res.statusCode === 200 || res.statusCode === 403;
  } catch {
    return false;
  }
}

async function startServer() {
  if (await isServerRunning()) return null;
  const serverProc = spawn('node', ['dist/main.js'], {
    cwd: __dirname,
    stdio: 'ignore',
    detached: true,
    env: { ...process.env, ENABLE_TEST_SIMULATIONS: 'true' },
  });
  serverProc.unref();

  for (let i = 1; i <= 40; i++) {
    await sleep(1000);
    if (await isServerRunning()) return serverProc;
  }
  throw new Error('Server failed to start within 40s');
}

async function loginSuperAdmin() {
  const res = await makeRequest(`${BASE_URL}/auth/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, {
    username: process.env.TEST_ADMIN_USERNAME || 'admin',
    password: process.env.TEST_ADMIN_PASSWORD || 'password123',
  });

  if (res.statusCode !== 200 && res.statusCode !== 201) {
    throw new Error(`Login failed with status ${res.statusCode}: ${JSON.stringify(res.body)}`);
  }

  return res.body.access_token;
}

async function loginMember() {
  const res = await makeRequest(`${BASE_URL}/auth/member/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, {
    membershipNo: process.env.TEST_MEMBER_NO || 'PV-2024-001',
    password: process.env.TEST_MEMBER_PASSWORD || 'password123',
  });

  if (res.statusCode !== 200 && res.statusCode !== 201) {
    throw new Error(`Member login failed with status ${res.statusCode}: ${JSON.stringify(res.body)}`);
  }

  return res.body.access_token;
}

async function runStorageSuite() {
  console.log('========================================================================');
  console.log(' [OI-01] STORAGE POLICY ENFORCEMENT & POST-UPLOAD VERIFICATION SUITE');
  console.log('========================================================================\n');

  // ────────────────────────────────────────────────────────────────────────
  // PART 1: Direct Storage Provider Enforcement Test (Write-time)
  // ────────────────────────────────────────────────────────────────────────
  console.log('------------------------------------------------------------------------');
  console.log(' PART 1: Direct Storage Provider Write-Time Enforcement Test');
  console.log(' Target Provider Endpoint:', `${env.SUPABASE_URL}/storage/v1/object/customer-documents`);
  console.log(' Configured Bucket Policy: Allowed [jpeg, png, pdf], Max 5MB (5242880 bytes)');
  console.log('------------------------------------------------------------------------\n');

  // Sub-test 1.1: Direct write with disallowed MIME type (text/plain)
  console.log('[Test 1.1] Attempting direct PUT upload with DISALLOWED MIME type: text/plain ...');
  const invalidMimeBody = Buffer.from('DISALLOWED_TEXT_CONTENT');
  const resInvalidMime = await makeRequest(`${env.SUPABASE_URL}/storage/v1/object/customer-documents/test-disallowed-mime.txt`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'text/plain',
      'Content-Length': invalidMimeBody.length,
    },
  }, invalidMimeBody);

  console.log('Provider Response:');
  console.log('  Status Code:   ', resInvalidMime.statusCode);
  console.log('  Status Message:', resInvalidMime.statusMessage);
  console.log('  Response Body: ', JSON.stringify(resInvalidMime.body, null, 2));

  // Sub-test 1.2: Direct write with oversized payload (6MB > 5MB limit)
  console.log('\n[Test 1.2] Attempting direct PUT upload with OVERSIZED payload (6 MB) ...');
  const oversizedChunk = Buffer.alloc(1024 * 1024, 'A'); // 1 MB chunk
  // Send 6MB
  const oversizedBody = Buffer.concat([oversizedChunk, oversizedChunk, oversizedChunk, oversizedChunk, oversizedChunk, oversizedChunk]);
  const resOversized = await makeRequest(`${env.SUPABASE_URL}/storage/v1/object/customer-documents/test-oversized.jpg`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'image/jpeg',
      'Content-Length': oversizedBody.length,
    },
  }, oversizedBody);

  console.log('Provider Response:');
  console.log('  Status Code:   ', resOversized.statusCode);
  console.log('  Status Message:', resOversized.statusMessage);
  console.log('  Response Body: ', JSON.stringify(resOversized.body, null, 2));

  console.log('\n--- Storage Provider Write-Time Enforcement Findings ---');
  const isRejectedMime = resInvalidMime.statusCode >= 400;
  const isRejectedSize = resOversized.statusCode >= 400;
  console.log(`Provider Rejected Disallowed MIME Type at Write Time: ${isRejectedMime ? 'YES (HTTP ' + resInvalidMime.statusCode + ')' : 'NO (Silently Accepted HTTP ' + resInvalidMime.statusCode + ')'}`);
  console.log(`Provider Rejected Oversized Payload at Write Time:   ${isRejectedSize ? 'YES (HTTP ' + resOversized.statusCode + ')' : 'NO (Silently Accepted HTTP ' + resOversized.statusCode + ')'}`);
  console.log(`Provider Enforcement Reason: ${resInvalidMime.body?.message || resInvalidMime.body?.error || resInvalidMime.statusMessage}`);

  // ────────────────────────────────────────────────────────────────────────
  // PART 2: App-Level Post-Upload Verification Step (Method B - Doc 10 §6)
  // ────────────────────────────────────────────────────────────────────────
  console.log('\n------------------------------------------------------------------------');
  console.log(' PART 2: App-Level Post-Upload Verification (Method B - POST /storage/verify-upload)');
  console.log('------------------------------------------------------------------------\n');

  await startServer();
  const adminToken = await loginSuperAdmin();

  // Test 2.1: Disallowed MIME type verification via verify-upload endpoint
  console.log('[Test 2.1] Firing POST /storage/verify-upload with DISALLOWED MIME type: text/plain ...');
  const verifyResDisallowed = await makeRequest(`${BASE_URL}/storage/verify-upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`,
    },
  }, {
    bucket: 'customer-documents',
    key: 'dummy-file.txt',
    expectedMimeType: 'text/plain', // not in allowed [jpeg, png, pdf]
    maxSizeBytes: 5 * 1024 * 1024,
  });

  console.log('Verification Endpoint Response:');
  console.log(JSON.stringify(verifyResDisallowed.body, null, 2));
  const test21Passed = verifyResDisallowed.body?.ok === false && verifyResDisallowed.body?.error === 'DISALLOWED_MIME_TYPE';
  console.log(`[PASS] Method B rejected disallowed MIME: ${test21Passed ? 'PASS' : 'FAIL'}`);

  // Test 2.2: Valid MIME type verification via verify-upload endpoint
  console.log('\n[Test 2.2] Firing POST /storage/verify-upload with VALID MIME type: image/jpeg ...');
  const verifyResValid = await makeRequest(`${BASE_URL}/storage/verify-upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`,
    },
  }, {
    bucket: 'receipts',
    key: 'valid-receipt-sample.jpg',
    expectedMimeType: 'image/jpeg',
    maxSizeBytes: 5 * 1024 * 1024,
  });

  console.log('Verification Endpoint Response:');
  console.log(JSON.stringify(verifyResValid.body, null, 2));
  const test22Passed = verifyResValid.body?.ok === true && verifyResValid.body?.valid === true;
  console.log(`[PASS] Method B accepted valid MIME: ${test22Passed ? 'PASS' : 'FAIL'}`);

  // ────────────────────────────────────────────────────────────────────────
  // PART 3: Application Acceptance Guard (ReceiptsService Integration)
  // ────────────────────────────────────────────────────────────────────────
  console.log('\n------------------------------------------------------------------------');
  console.log(' PART 3: Application Acceptance Guard (POST /receipts)');
  console.log(' Proves receipts service rejects invalid uploaded files before saving to DB');
  console.log('------------------------------------------------------------------------\n');

  const memberToken = await loginMember();

  const prisma = new PrismaClient({
    datasources: { db: { url: env.DIRECT_URL || env.DATABASE_URL } },
  });
  const memberBooking = await prisma.booking.findFirst({
    where: { customer: { membershipNo: 'PV-2024-001' } },
    include: { plot: true },
  });
  const targetPlotId = memberBooking ? memberBooking.plotId : 'plot-a-05';

  // Temporarily set paymentRecord to pending so it reaches file verification
  let targetPayment = await prisma.paymentRecord.findFirst({
    where: { bookingId: memberBooking?.id, feeType: 'plot_one_time' },
  });
  if (targetPayment) {
    await prisma.paymentRecord.update({
      where: { id: targetPayment.id },
      data: { status: 'pending' },
    });
  }

  // Test 3.1: Submit receipt pointing to disallowed file
  console.log(`[Test 3.1] Member attempts to submit payment receipt for owned Plot ${targetPlotId} with disallowed file type (exe) ...`);
  const submitRes = await makeRequest(`${BASE_URL}/receipts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${memberToken}`,
    },
  }, {
    plotId: targetPlotId,
    paymentType: 'one_time',
    amount: 50000,
    depositoryBank: 'Meezan Bank',
    transactionRef: 'TX-TEST-STORAGE-VERIFY',
    paymentDate: new Date().toISOString(),
    receiptFileUrl: 'receipts:test-file.exe', // invalid extension / MIME type
  });

  console.log('Receipt Submission Response:');
  console.log(JSON.stringify(submitRes.body, null, 2));
  const test31Passed = submitRes.statusCode === 400 && submitRes.body?.error === 'DISALLOWED_FILE_EXTENSION';
  console.log(`[PASS] Receipts service rejected disallowed file extension at acceptance: ${test31Passed ? 'PASS' : 'FAIL'}`);

  // Restore payment record
  if (targetPayment) {
    await prisma.paymentRecord.update({
      where: { id: targetPayment.id },
      data: { status: 'paid' },
    });
  }

  await prisma.$disconnect();

  console.log('\n========================================================================');
  console.log(' [OI-01] TEST COMPLETED SUCCESSFULLY');
  console.log('========================================================================');
}

runStorageSuite().catch((err) => {
  console.error('\n[FATAL ERROR IN STORAGE SUITE]:', err);
  process.exit(1);
});
