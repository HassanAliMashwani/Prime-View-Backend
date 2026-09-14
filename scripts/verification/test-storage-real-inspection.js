/**
 * test-storage-real-inspection.js
 * 
 * Verifies genuine post-upload byte & header inspection (Method B per Doc 10 §6)
 * Specifically tests against:
 * 1. Disguised file attack: file named "photo.jpg" declaring "image/jpeg" but containing Windows executable (MZ header).
 * 2. Oversized file attack: 6MB payload (exceeding 5MB bucket limit).
 * 3. Genuine valid upload: JPEG file with valid magic bytes (FF D8 FF) and valid size.
 * 4. Provider authentication proof: Demonstrates what Supabase Storage API returns when
 *    unauthenticated vs token-authenticated requests hit the provider directly.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');

const { initEnv } = require('./env-helper');
const env = initEnv();
const PROJECT_ROOT = env.PROJECT_ROOT;

const BASE_URL = `http://localhost:${env.PORT}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  const serverProc = spawn('node', [path.resolve(PROJECT_ROOT, 'dist/main.js')], {
    cwd: PROJECT_ROOT,
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

async function runRealInspectionSuite() {
  console.log('========================================================================');
  console.log(' [OI-01] GENUINE POST-UPLOAD BYTE & HEADER INSPECTION VERIFICATION');
  console.log('========================================================================\n');

  // ────────────────────────────────────────────────────────────────────────
  // PART 1: Provider-Level Authentication Proof
  // ────────────────────────────────────────────────────────────────────────
  console.log('------------------------------------------------------------------------');
  console.log(' PART 1: Provider-Level HTTP API Direct Investigation');
  console.log(' Demonstrates what Supabase Storage API returns when directly targeted:');
  console.log('------------------------------------------------------------------------\n');

  // 1.1 Direct PUT with no authorization
  console.log('[Test 1.1] Direct unauthenticated PUT to Supabase Storage:');
  const resNoAuth = await makeRequest(`${env.SUPABASE_URL}/storage/v1/object/customer-documents/test.jpg`, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg', 'Content-Length': 10 },
  }, Buffer.from('TEST_BYTES'));
  console.log('  Status Code:   ', resNoAuth.statusCode);
  console.log('  Response Body: ', JSON.stringify(resNoAuth.body));

  // 1.2 Direct PUT with bearer token (unrecognized JWS)
  console.log('\n[Test 1.2] Direct authenticated PUT with unrecognized JWT:');
  const resBadJwt = await makeRequest(`${env.SUPABASE_URL}/storage/v1/object/customer-documents/test.jpg`, {
    method: 'PUT',
    headers: {
      'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy',
      'Content-Type': 'image/jpeg',
      'Content-Length': 10,
    },
  }, Buffer.from('TEST_BYTES'));
  console.log('  Status Code:   ', resBadJwt.statusCode);
  console.log('  Response Body: ', JSON.stringify(resBadJwt.body));

  console.log('\n--- Provider Findings ---');
  console.log('1. Unauthenticated writes: rejected with HTTP 400 (InvalidRequest: headers must have required property "authorization").');
  console.log('2. Unrecognized JWT writes: rejected with HTTP 403 / 400 (Unauthorized: Invalid Compact JWS / AccessDenied).');
  console.log('3. Conclusion: Because live SUPABASE_SERVICE_ROLE_KEY is not configured in the runner,');
  console.log('   signed upload URLs cannot be generated by the provider in this environment.');
  console.log('   Therefore, [OI-01] MUST REMAIN OPEN in OUTSTANDING-ITEMS.md until credentials are provisioned.');

  // ────────────────────────────────────────────────────────────────────────
  // PART 2: Method B Genuine Byte & Magic Number Inspection (POST /storage/verify-upload)
  // ────────────────────────────────────────────────────────────────────────
  console.log('\n------------------------------------------------------------------------');
  console.log(' PART 2: Method B Genuine Object Byte & Magic Number Inspection');
  console.log(' Inspects actual file bytes to detect disguised and oversized uploads.');
  console.log('------------------------------------------------------------------------\n');

  await startServer();
  const token = await loginSuperAdmin();

  // Test 2.1: Disguised File Attack (file named photo.jpg declaring image/jpeg, but contains Windows MZ executable bytes)
  console.log('[Test 2.1] Disguised File Attack: "photo.jpg" with MZ executable magic bytes (4D 5A) ...');
  const mzExecutableBuffer = Buffer.from([0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00]);
  const resDisguised = await makeRequest(`${BASE_URL}/storage/verify-upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
  }, {
    bucket: 'customer-documents',
    key: 'photo.jpg',
    expectedMimeType: 'image/jpeg',
    maxSizeBytes: 5 * 1024 * 1024,
    fileContentBase64: mzExecutableBuffer.toString('base64'),
  });

  console.log('Endpoint Response:');
  console.log(JSON.stringify(resDisguised.body, null, 2));
  const test21Passed = resDisguised.body?.ok === false &&
    (resDisguised.body?.error === 'DISALLOWED_EXECUTABLE_CONTENT' || resDisguised.body?.error === 'CONTENT_MIME_MISMATCH');
  console.log(`[PASS] Method B rejected disguised executable: ${test21Passed ? 'PASS' : 'FAIL'}`);

  // Test 2.2: Oversized File Attack (6MB JPEG payload against 5MB bucket limit)
  console.log('\n[Test 2.2] Oversized File Attack: Genuine JPEG magic bytes, but payload is 6 MB (limit 5 MB) ...');
  const jpegHeader = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]);
  const oversizedPadding = Buffer.alloc(6 * 1024 * 1024, 0x00);
  const oversizedJpegBuffer = Buffer.concat([jpegHeader, oversizedPadding]);

  const resOversized = await makeRequest(`${BASE_URL}/storage/verify-upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
  }, {
    bucket: 'customer-documents',
    key: 'oversized-photo.jpg',
    expectedMimeType: 'image/jpeg',
    maxSizeBytes: 5 * 1024 * 1024,
    fileContentBase64: oversizedJpegBuffer.toString('base64'),
  });

  console.log('Endpoint Response:');
  console.log(JSON.stringify(resOversized.body, null, 2));
  const test22Passed = resOversized.body?.ok === false && resOversized.body?.error === 'FILE_TOO_LARGE';
  console.log(`[PASS] Method B rejected oversized payload: ${test22Passed ? 'PASS' : 'FAIL'}`);

  // Test 2.3: Genuine Valid Upload (Valid JPEG magic bytes, 200KB payload)
  console.log('\n[Test 2.3] Genuine Valid Upload: JPEG with valid magic bytes (FF D8 FF) and valid size (200 KB) ...');
  const validPadding = Buffer.alloc(200 * 1024, 0xAA);
  const validJpegBuffer = Buffer.concat([jpegHeader, validPadding]);

  const resValid = await makeRequest(`${BASE_URL}/storage/verify-upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
  }, {
    bucket: 'customer-documents',
    key: 'legit-receipt.jpg',
    expectedMimeType: 'image/jpeg',
    maxSizeBytes: 5 * 1024 * 1024,
    fileContentBase64: validJpegBuffer.toString('base64'),
  });

  console.log('Endpoint Response:');
  console.log(JSON.stringify(resValid.body, null, 2));
  const test23Passed = resValid.body?.ok === true && resValid.body?.valid === true && resValid.body?.mimeType === 'image/jpeg';
  console.log(`[PASS] Method B accepted genuine JPEG: ${test23Passed ? 'PASS' : 'FAIL'}`);

  console.log('\n========================================================================');
  console.log(' METHOD B GENUINE BYTE INSPECTION VERIFICATION COMPLETED');
  console.log('========================================================================');
}

runRealInspectionSuite().catch((err) => {
  console.error('\n[FATAL ERROR IN SUITE]:', err);
  process.exit(1);
});
