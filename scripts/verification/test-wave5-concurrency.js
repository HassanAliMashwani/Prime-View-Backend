/**
 * test-wave5-concurrency.js
 * Wave 5: Dual-Process Concurrency Verification & Atomic Rollback Proof
 *
 * Requirements:
 * 1. Spawn two independent OS Node.js child processes firing simultaneous POST /plots/:id/book.
 * 2. Verify exactly one gets 201 Created and the other gets 409 Conflict (ALREADY_BOOKED / LOCK_LOST).
 * 3. Verify PostgreSQL ends up with exactly 1 Booking row and exactly 1 PLOT_BOOKED AuditEntry (no duplicates/partials).
 * 4. Force failure inside $transaction (simulateRollback at document step) and verify 100% rollback:
 *    0 orphaned Booking, PaymentRecord, CustomerDocument, or AuditEntry rows in PostgreSQL.
 */
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');
const http = require('http');

const { initEnv } = require('./env-helper');
const env = initEnv();
const PROJECT_ROOT = env.PROJECT_ROOT;

const BASE_URL = `http://localhost:${env.PORT}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function httpRequest(urlStr, options = {}, body = null) {
  return new Promise((resolve) => {
    const parsed = new URL(urlStr);
    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    const req = http.request(reqOptions, (res) => {
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
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function isServerRunning() {
  try {
    const res = await httpRequest(`${BASE_URL}/blocks`);
    return res.statusCode === 401 || res.statusCode === 200 || res.statusCode === 403;
  } catch {
    return false;
  }
}

async function startServer() {
  console.log('[Setup] Checking if NestJS server is running on', BASE_URL, '...');
  if (await isServerRunning()) {
    console.log('[Setup] NestJS server is already running.');
    return null;
  }

  console.log('[Setup] Starting NestJS server from dist/main.js ...');
  const serverProc = spawn('node', [path.resolve(PROJECT_ROOT, 'dist/main.js')], {
    cwd: PROJECT_ROOT,
    stdio: 'ignore',
    detached: true,
    env: { ...process.env, ENABLE_TEST_SIMULATIONS: 'true' },
  });
  serverProc.unref();

  const maxWait = 40;
  for (let i = 1; i <= maxWait; i++) {
    await sleep(1000);
    if (await isServerRunning()) {
      console.log(`[Setup] NestJS server became healthy after ${i}s.`);
      return serverProc;
    }
    if (i % 5 === 0) console.log(`[Setup] Waiting for server... (${i}s)`);
  }

  throw new Error('Server failed to start within 40 seconds.');
}

async function loginSuperAdmin() {
  const res = await httpRequest(`${BASE_URL}/auth/admin/login`, {
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

// Spawns worker process and captures JSON output
function runWorker(args) {
  return new Promise((resolve) => {
    const proc = spawn('node', [path.resolve(__dirname, 'wave5-worker.js'), ...args], {
      cwd: __dirname,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });

    proc.on('close', (code) => {
      let parsed = null;
      try {
        parsed = JSON.parse(stdout.trim());
      } catch {
        parsed = { rawStdout: stdout, rawStderr: stderr, code };
      }
      resolve({ code, output: parsed });
    });
  });
}

async function runWave5Suite() {
  console.log('========================================================================');
  console.log(' WAVE 5: DUAL-PROCESS CONCURRENCY VERIFICATION & ATOMIC ROLLBACK PROOF');
  console.log('========================================================================\n');

  // Connect Prisma to PostgreSQL
  const prisma = new PrismaClient({
    datasources: { db: { url: env.DIRECT_URL || env.DATABASE_URL } },
  });

  try {
    // 1. Start server & login
    let spawnedServer = await startServer();
    console.log('[Auth] Authenticating Super Admin...');
    const token = await loginSuperAdmin();
    console.log('[Auth] Super Admin authenticated successfully.\n');

    // 2. Select 2 available plots for tests
    const availablePlots = await prisma.plot.findMany({
      where: {
        status: 'available',
        category: { not: 'amenity' },
        isAdjustment: false,
      },
      take: 2,
      select: { id: true, plotNumber: true, blockId: true, price: true, status: true },
    });

    if (availablePlots.length < 2) {
      throw new Error(`Insufficient available test plots. Found ${availablePlots.length}, need at least 2.`);
    }

    const testPlot1 = availablePlots[0];
    const testPlot2 = availablePlots[1];

    console.log('Selected Test Plots:');
    console.log(` - Plot 1 (Concurrency Race):  ID=${testPlot1.id}, Number="${testPlot1.plotNumber}", Block="${testPlot1.blockId}"`);
    console.log(` - Plot 2 (Atomic Rollback):    ID=${testPlot2.id}, Number="${testPlot2.plotNumber}", Block="${testPlot2.blockId}"`);
    console.log('');

    // ────────────────────────────────────────────────────────────────────────
    // TEST 1: Dual-Process Concurrency Race on POST /plots/:id/book
    // ────────────────────────────────────────────────────────────────────────
    console.log('========================================================================');
    console.log(' TEST 1: Simultaneous Dual-Process Concurrency Race');
    console.log(' Target Plot:', testPlot1.plotNumber, `(${testPlot1.id})`);
    console.log('========================================================================');

    // Synchronize both child processes to fire at the exact same millisecond
    const syncTime = Date.now() + 2000;
    console.log(`[Test 1] Spawning Process A and Process B with synchronized target time: ${new Date(syncTime).toISOString()}`);

    const [workerAPromise, workerBPromise] = [
      runWorker(['--plotId', testPlot1.id, '--token', token, '--workerId', 'A', '--syncTime', syncTime.toString()]),
      runWorker(['--plotId', testPlot1.id, '--token', token, '--workerId', 'B', '--syncTime', syncTime.toString()]),
    ];

    const [resA, resB] = await Promise.all([workerAPromise, workerBPromise]);

    console.log('\n--- Process Execution Results ---');
    console.log('Process A Result:');
    console.log(JSON.stringify(resA.output, null, 2));
    console.log('\nProcess B Result:');
    console.log(JSON.stringify(resB.output, null, 2));

    const statusA = resA.output?.statusCode;
    const statusB = resB.output?.statusCode;

    console.log(`\nProcess Outcomes: A -> HTTP ${statusA}, B -> HTTP ${statusB}`);

    const hasWinner = (statusA === 201 && statusB === 409) || (statusA === 409 && statusB === 201);
    if (!hasWinner) {
      throw new Error(`Concurrency race assertion failed! Expected one 201 and one 409, got A=${statusA}, B=${statusB}`);
    }

    const winner = statusA === 201 ? 'Process A' : 'Process B';
    const loser = statusA === 409 ? 'Process A' : 'Process B';
    const loserError = statusA === 409 ? resA.output?.body?.error : resB.output?.body?.error;

    console.log(`[PASS] Concurrency Winner: ${winner} (HTTP 201 Created)`);
    console.log(`[PASS] Concurrency Loser:  ${loser} (HTTP 409 Conflict, Typed Error: "${loserError}")`);

    // Verify PostgreSQL State for Plot 1
    console.log('\n--- PostgreSQL Ground Truth Verification for Plot 1 ---');
    const dbPlot1 = await prisma.plot.findUnique({
      where: { id: testPlot1.id },
      select: { id: true, plotNumber: true, status: true, currentOwnerId: true },
    });
    console.log('Plot State:', dbPlot1);

    const dbBookings1 = await prisma.booking.findMany({
      where: { plotId: testPlot1.id },
      select: { id: true, plotId: true, customerId: true, status: true, createdByAdminId: true },
    });
    console.log(`Booking Rows Created: ${dbBookings1.length} (Expected: EXACTLY 1)`);
    console.log('Bookings:', dbBookings1);

    const winningBookingId = dbBookings1[0]?.id;

    const dbAudits1 = await prisma.auditEntry.findMany({
      where: {
        entityId: winningBookingId,
        action: 'PLOT_BOOKED',
      },
      select: { id: true, action: true, entityType: true, entityId: true, actorId: true, details: true },
    });
    console.log(`PLOT_BOOKED AuditEntry Rows: ${dbAudits1.length} (Expected: EXACTLY 1)`);
    console.log('Audit Entry:', dbAudits1);

    // Verify PaymentRecord Ground Truth for Plot 1
    console.log('\n--- PaymentRecord Ground Truth Verification for Plot 1 ---');
    const winningPayments = await prisma.paymentRecord.findMany({
      where: { bookingId: winningBookingId },
    });
    console.log(`Winning Booking (${winningBookingId}) PaymentRecord Rows: ${winningPayments.length}`);
    console.log('Actual PaymentRecord Rows Found:');
    console.log(JSON.stringify(winningPayments, null, 2));

    const plotPriceRecords = winningPayments.filter((p) => p.feeType === 'plot_one_time');
    console.log(`\nPlot Price PaymentRecord Count: ${plotPriceRecords.length} (Expected: EXACTLY 1)`);

    if (plotPriceRecords.length !== 1) {
      throw new Error(`Expected exactly 1 plot_one_time PaymentRecord, found ${plotPriceRecords.length}`);
    }

    const plotPayment = plotPriceRecords[0];
    if (Number(plotPayment.amount) !== Number(testPlot1.price)) {
      throw new Error(`PaymentRecord amount (${plotPayment.amount}) does not match plot price (${testPlot1.price})`);
    }
    if (plotPayment.status !== 'paid') {
      throw new Error(`PaymentRecord status expected 'paid', got '${plotPayment.status}'`);
    }

    // Verify 0 PaymentRecord rows exist tied to the losing process's request
    const loserWorkerId = winner === 'Process A' ? 'B' : 'A';
    const loserEmailTag = `buyer.${loserWorkerId.toLowerCase()}`;
    const loserPayments = await prisma.paymentRecord.findMany({
      where: {
        booking: {
          plotId: testPlot1.id,
          id: { not: winningBookingId },
        },
      },
    });
    console.log(`\nLosing Process (${loser}, email tag "${loserEmailTag}") PaymentRecord Rows: ${loserPayments.length} (Expected: 0)`);
    console.log('Losing Process Payment Records:', loserPayments);

    if (loserPayments.length !== 0) {
      throw new Error(`Orphaned PaymentRecord rows found for losing process! Rows: ${JSON.stringify(loserPayments)}`);
    }

    if (dbPlot1.status !== 'booked') throw new Error(`Expected Plot 1 status 'booked', got '${dbPlot1.status}'`);
    if (dbBookings1.length !== 1) throw new Error(`Expected exactly 1 Booking row, got ${dbBookings1.length}`);
    if (dbAudits1.length !== 1) throw new Error(`Expected exactly 1 PLOT_BOOKED AuditEntry row, got ${dbAudits1.length}`);

    console.log('\n>>> TEST 1 RESULT: 100% PASSED (Zero duplicate bookings, exact payment verified, zero loser payments)\n');

    // ────────────────────────────────────────────────────────────────────────
    // TEST 2: Atomic Rollback & Zero-Orphan Proof
    // ────────────────────────────────────────────────────────────────────────
    console.log('========================================================================');
    console.log(' TEST 2: Atomic Rollback & Zero-Orphan Isolation Proof');
    console.log(' Target Plot:', testPlot2.plotNumber, `(${testPlot2.id})`);
    console.log(' Failure Injection: simulateRollback=true at document generation step');
    console.log('========================================================================');

    // Pre-flight check on Plot 2
    const preCheckPlot2 = await prisma.plot.findUnique({
      where: { id: testPlot2.id },
      select: { id: true, plotNumber: true, status: true, currentOwnerId: true },
    });
    console.log('[Pre-Flight] Baseline Plot 2 State:', preCheckPlot2);

    const preBookings2 = await prisma.booking.count({ where: { plotId: testPlot2.id } });
    console.log(`[Pre-Flight] Baseline Booking Count: ${preBookings2} (Expected: 0)`);

    // Fire booking with simulateRollback = true
    console.log('\n[Action] Firing POST /plots/:id/book with simulateRollback=true ...');
    const rollbackWorkerResult = await runWorker([
      '--plotId', testPlot2.id,
      '--token', token,
      '--workerId', 'RollbackTester',
      '--simulateRollback', 'true',
    ]);

    console.log('Worker Result:');
    console.log(JSON.stringify(rollbackWorkerResult.output, null, 2));

    const rbStatus = rollbackWorkerResult.output?.statusCode;
    const rbError = rollbackWorkerResult.output?.body?.error;

    if (rbStatus !== 400 || rbError !== 'SIMULATED_TRANSACTION_FAILURE_ON_DOCUMENT_STEP') {
      throw new Error(`Expected HTTP 400 SIMULATED_TRANSACTION_FAILURE_ON_DOCUMENT_STEP, got ${rbStatus} (${rbError})`);
    }

    console.log(`[PASS] Transaction aborted by server: HTTP ${rbStatus} (${rbError})`);

    // Post-Flight Direct PostgreSQL Verification for Plot 2
    console.log('\n--- PostgreSQL Ground Truth Verification for Rollback on Plot 2 ---');
    const postCheckPlot2 = await prisma.plot.findUnique({
      where: { id: testPlot2.id },
      select: { id: true, plotNumber: true, status: true, currentOwnerId: true, lockedBy: true },
    });
    console.log('Post-Rollback Plot State:');
    console.log(postCheckPlot2);

    const postBookings2 = await prisma.booking.findMany({
      where: { plotId: testPlot2.id },
    });
    console.log(`Post-Rollback Booking Rows: ${postBookings2.length} (Expected: 0)`);

    // Check payment records (any payment record linked to bookings for this plot)
    const postPayments2 = await prisma.paymentRecord.findMany({
      where: {
        booking: {
          plotId: testPlot2.id,
        },
      },
    });
    console.log(`Post-Rollback PaymentRecord Rows: ${postPayments2.length} (Expected: 0)`);

    // Check society documents
    const postDocs2 = await prisma.societyDocument.findMany({
      where: {
        booking: {
          plotId: testPlot2.id,
        },
      },
    });
    console.log(`Post-Rollback SocietyDocument Rows: ${postDocs2.length} (Expected: 0)`);

    // Check audit entries
    const postAudits2 = await prisma.auditEntry.findMany({
      where: {
        entityId: testPlot2.id,
        action: 'PLOT_BOOKED',
      },
    });
    console.log(`Post-Rollback PLOT_BOOKED AuditEntry Rows: ${postAudits2.length} (Expected: 0)`);

    if (postCheckPlot2.status !== 'available') {
      throw new Error(`Plot status rolled back incorrectly: expected 'available', got '${postCheckPlot2.status}'`);
    }
    if (postCheckPlot2.currentOwnerId !== null) {
      throw new Error(`Plot currentOwnerId rolled back incorrectly: expected null, got '${postCheckPlot2.currentOwnerId}'`);
    }
    if (postBookings2.length !== 0) {
      throw new Error(`Orphaned Booking rows detected! Count: ${postBookings2.length}`);
    }
    if (postPayments2.length !== 0) {
      throw new Error(`Orphaned PaymentRecord rows detected! Count: ${postPayments2.length}`);
    }
    if (postDocs2.length !== 0) {
      throw new Error(`Orphaned SocietyDocument rows detected! Count: ${postDocs2.length}`);
    }
    if (postAudits2.length !== 0) {
      throw new Error(`Orphaned AuditEntry rows detected! Count: ${postAudits2.length}`);
    }

    console.log('\n>>> TEST 2 RESULT: 100% PASSED (Zero orphans: 0 bookings, 0 payments, 0 documents, 0 audits)\n');

    console.log('========================================================================');
    console.log(' WAVE 5 VERIFICATION COMPLETE: ALL CONCURRENCY & ROLLBACK TESTS PASSED');
    console.log('========================================================================');
  } finally {
    await prisma.$disconnect();
  }
}

runWave5Suite().catch((err) => {
  console.error('\n[FATAL ERROR IN WAVE 5 SUITE]:', err);
  process.exit(1);
});
