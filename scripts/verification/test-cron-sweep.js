const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Ensure local .env is loaded
const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      const k = trimmed.slice(0, idx).trim();
      let v = trimmed.slice(idx + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!process.env[k]) {
        process.env[k] = v;
      }
    }
  }
}

const CRON_SECRET = process.env.CRON_SECRET;
const PORT = process.env.PORT || 3001;
const BASE_URL = `http://localhost:${PORT}`;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function makeRequest(path, headers = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      ...headers,
    },
  });
  let body;
  try {
    body = await res.json();
  } catch (err) {
    body = await res.text();
  }
  return { status: res.status, body };
}

async function runTests() {
  console.log(`Starting GET /sweep/cron verification tests against ${BASE_URL}...`);
  console.log(`CRON_SECRET from env: "${CRON_SECRET}"\n`);

  if (!CRON_SECRET) {
    console.error('ERROR: CRON_SECRET not found in environment or .env!');
    process.exit(1);
  }

  // --- TEST 1: No Authorization Header ---
  console.log('[TEST 1] Calling GET /sweep/cron with NO Authorization header:');
  const res1 = await makeRequest('/sweep/cron');
  console.log(`Status Code: ${res1.status}`);
  console.log(`Response Body: ${JSON.stringify(res1.body, null, 2)}`);
  if (res1.status !== 401) {
    throw new Error(`Expected 401 Unauthorized, got ${res1.status}`);
  }
  console.log('✔ Test 1 PASSED (401 Unauthorized)\n');

  // --- TEST 2: Wrong Bearer Token ---
  console.log('[TEST 2] Calling GET /sweep/cron with WRONG Bearer token:');
  const res2 = await makeRequest('/sweep/cron', {
    Authorization: 'Bearer totally-wrong-token-abc-xyz',
  });
  console.log(`Status Code: ${res2.status}`);
  console.log(`Response Body: ${JSON.stringify(res2.body, null, 2)}`);
  if (res2.status !== 401) {
    throw new Error(`Expected 401 Unauthorized, got ${res2.status}`);
  }
  console.log('✔ Test 2 PASSED (401 Unauthorized)\n');

  // --- TEST 3: Correct CRON_SECRET Bearer Token ---
  console.log('[TEST 3] Calling GET /sweep/cron with CORRECT Bearer token:');
  const res3 = await makeRequest('/sweep/cron', {
    Authorization: `Bearer ${CRON_SECRET}`,
  });
  console.log(`Status Code: ${res3.status}`);
  console.log(`Response Body: ${JSON.stringify(res3.body, null, 2)}`);
  if (res3.status !== 200) {
    throw new Error(`Expected 200 OK, got ${res3.status}`);
  }
  if (!res3.body?.ok || !res3.body?.data || typeof res3.body?.status !== 'object') {
    throw new Error(`Expected ok: true with sweep data & status, got: ${JSON.stringify(res3.body)}`);
  }
  console.log('✔ Test 3 PASSED (200 OK - Sweep logic executed successfully)\n');

  console.log('==============================================');
  console.log('ALL THREE VERIFICATION CHECKS PASSED (401 / 401 / 200)');
  console.log('==============================================');
}

async function main() {
  // Check if server is already running
  let serverProcess = null;
  let isRunning = false;
  try {
    const probe = await fetch(`${BASE_URL}/sweep/status`);
    if (probe.ok) isRunning = true;
  } catch (e) {}

  if (!isRunning) {
    console.log('Launching backend server for test...');
    serverProcess = spawn('node', ['dist/main.js'], {
      cwd: path.resolve(__dirname, '../..'),
      stdio: 'inherit',
      env: { ...process.env },
    });

    // Wait for server to become ready
    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      try {
        const probe = await fetch(`${BASE_URL}/sweep/status`);
        if (probe.ok) {
          isRunning = true;
          break;
        }
      } catch (e) {}
    }

    if (!isRunning) {
      if (serverProcess) serverProcess.kill();
      throw new Error('Server failed to start within 30 seconds');
    }
  }

  try {
    await runTests();
  } finally {
    if (serverProcess) {
      console.log('Shutting down spawned test server...');
      serverProcess.kill();
    }
  }
}

main().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
