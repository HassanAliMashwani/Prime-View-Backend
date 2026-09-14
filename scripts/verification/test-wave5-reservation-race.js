/**
 * test-wave5-reservation-race.js
 * Wave 5: Reservation Concurrency & Live Booking vs Reservation Race Verification
 *
 * Test 1: Dual-Process Simultaneous Reservation Race (reservePlot vs reservePlot on available plot)
 * Test 2: Live Simultaneous Race between bookPlot and reservePlot on available plot
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
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

async function runReservationRaceSuite() {
  console.log('========================================================================');
  console.log(' WAVE 5: RESERVATION CONCURRENCY & LIVE BOOKING-VS-RESERVE RACE SUITE');
  console.log('========================================================================\n');

  const prisma = new PrismaClient({
    datasources: { db: { url: env.DIRECT_URL || env.DATABASE_URL } },
  });

  try {
    await startServer();
    console.log('[Auth] Authenticating Super Admin...');
    const token = await loginSuperAdmin();
    console.log('[Auth] Super Admin authenticated successfully.\n');

    // Select 2 available plots for the tests
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
      throw new Error(`Need at least 2 available plots for reservation race suite, found ${availablePlots.length}`);
    }

    const testPlot1 = availablePlots[0];
    const testPlot2 = availablePlots[1];

    console.log('Selected Test Plots:');
    console.log(` - Test 1 Plot (Reserve vs Reserve Race): ID=${testPlot1.id}, Number="${testPlot1.plotNumber}", Block="${testPlot1.blockId}"`);
    console.log(` - Test 2 Plot (Book vs Reserve Live Race): ID=${testPlot2.id}, Number="${testPlot2.plotNumber}", Block="${testPlot2.blockId}"\n`);

    // ────────────────────────────────────────────────────────────────────────
    // TEST 1: Simultaneous Dual-Process reservePlot vs reservePlot on Plot 1
    // ────────────────────────────────────────────────────────────────────────
    console.log('========================================================================');
    console.log(' TEST 1: Simultaneous Dual-Process Reservation Race (Reserve vs Reserve)');
    console.log(' Target Plot:', testPlot1.plotNumber, `(${testPlot1.id})`);
    console.log(' Design Model: Multi-Reservation Queue (Doc 02 §4 - duplicate reservations allowed)');
    console.log('========================================================================');

    const syncTime1 = Date.now() + 2000;
    console.log(`[Test 1] Spawning Process A and Process B (action=reserve) targeting: ${new Date(syncTime1).toISOString()}`);

    const [resA1, resB1] = await Promise.all([
      runWorker(['--plotId', testPlot1.id, '--token', token, '--workerId', 'A', '--action', 'reserve', '--syncTime', syncTime1.toString()]),
      runWorker(['--plotId', testPlot1.id, '--token', token, '--workerId', 'B', '--action', 'reserve', '--syncTime', syncTime1.toString()]),
    ]);

    console.log('\n--- Process Execution Results ---');
    console.log('Process A Result:');
    console.log(JSON.stringify(resA1.output, null, 2));
    console.log('\nProcess B Result:');
    console.log(JSON.stringify(resB1.output, null, 2));

    const statusA1 = resA1.output?.statusCode;
    const statusB1 = resB1.output?.statusCode;
    console.log(`\nProcess Outcomes: A -> HTTP ${statusA1}, B -> HTTP ${statusB1}`);

    // Verify PostgreSQL Ground Truth for Test 1 Plot
    console.log('\n--- PostgreSQL Ground Truth Verification for Test 1 ---');
    const dbPlot1 = await prisma.plot.findUnique({
      where: { id: testPlot1.id },
      select: { id: true, plotNumber: true, status: true, currentOwnerId: true },
    });
    console.log('Plot State:', dbPlot1);

    const dbRes1 = await prisma.reservation.findMany({
      where: { plotId: testPlot1.id },
      select: { id: true, customerName: true, status: true, tokenFee: true, createdAt: true },
    });
    console.log(`Reservation Rows on Plot: ${dbRes1.length}`);
    console.log('Reservations:', dbRes1);

    const dbAudits1 = await prisma.auditEntry.findMany({
      where: {
        entityType: 'reservation',
        action: 'PLOT_RESERVED',
        details: { contains: testPlot1.plotNumber },
      },
      select: { id: true, action: true, entityType: true, entityId: true, details: true },
    });
    console.log(`PLOT_RESERVED AuditEntry Rows: ${dbAudits1.length}`);
    console.log('Audit Entries:', dbAudits1);

    if (dbPlot1.status !== 'reserved') {
      throw new Error(`Expected Plot status 'reserved', got '${dbPlot1.status}'`);
    }
    if (dbRes1.length !== 2) {
      throw new Error(`Expected exactly 2 active reservation rows in multi-reservation queue, got ${dbRes1.length}`);
    }
    for (const r of dbRes1) {
      if (r.status !== 'active') throw new Error(`Reservation ${r.id} expected status 'active', got '${r.status}'`);
    }

    console.log('\n>>> TEST 1 RESULT: 100% PASSED (Multi-reservation queue preserved with row-level serialization)\n');

    // ────────────────────────────────────────────────────────────────────────
    // TEST 2: Live Simultaneous Race between bookPlot() and reservePlot() on Plot 2
    // ────────────────────────────────────────────────────────────────────────
    console.log('========================================================================');
    console.log(' TEST 2: Live Simultaneous Concurrency Race: bookPlot() vs reservePlot()');
    console.log(' Target Plot:', testPlot2.plotNumber, `(${testPlot2.id})`);
    console.log(' Guard Mechanism: FOR UPDATE row lock serializes write ordering');
    console.log('========================================================================');

    const syncTime2 = Date.now() + 2000;
    console.log(`[Test 2] Spawning Process A (action=book) and Process B (action=reserve) targeting: ${new Date(syncTime2).toISOString()}`);

    const [resA2, resB2] = await Promise.all([
      runWorker(['--plotId', testPlot2.id, '--token', token, '--workerId', 'BookWorker', '--action', 'book', '--syncTime', syncTime2.toString()]),
      runWorker(['--plotId', testPlot2.id, '--token', token, '--workerId', 'ReserveWorker', '--action', 'reserve', '--syncTime', syncTime2.toString()]),
    ]);

    console.log('\n--- Process Execution Results ---');
    console.log('Process A (bookPlot) Result:');
    console.log(JSON.stringify(resA2.output, null, 2));
    console.log('\nProcess B (reservePlot) Result:');
    console.log(JSON.stringify(resB2.output, null, 2));

    const statusBook = resA2.output?.statusCode;
    const statusReserve = resB2.output?.statusCode;
    console.log(`\nRace Outcomes: Book -> HTTP ${statusBook}, Reserve -> HTTP ${statusReserve}`);

    // Verify PostgreSQL Ground Truth for Test 2 Plot
    console.log('\n--- PostgreSQL Ground Truth Verification for Test 2 ---');
    const dbPlot2 = await prisma.plot.findUnique({
      where: { id: testPlot2.id },
      select: { id: true, plotNumber: true, status: true, currentOwnerId: true },
    });
    console.log('Final Plot State:', dbPlot2);

    const dbBookings2 = await prisma.booking.findMany({
      where: { plotId: testPlot2.id },
      select: { id: true, customerId: true, status: true },
    });
    console.log(`Booking Rows Created: ${dbBookings2.length}`);
    console.log('Bookings:', dbBookings2);

    const dbRes2 = await prisma.reservation.findMany({
      where: { plotId: testPlot2.id },
      select: { id: true, customerName: true, status: true, resolutionNote: true },
    });
    console.log(`Reservation Rows Found: ${dbRes2.length}`);
    console.log('Reservations:', dbRes2);

    // Commit-ordering assertions:
    // If booking acquired lock first:
    // - Booking: 201 Created
    // - Reserve: 409 Conflict (PLOT_ALREADY_BOOKED)
    // If reserve acquired lock first:
    // - Reserve: 201 Created (Reservation active)
    // - Booking: 201 Created (Booking completed, automatically marked reservation as superseded)
    if (statusBook === 201 && statusReserve === 409) {
      console.log('\n[Ordering Analysis]: Booking transaction acquired lock first and committed.');
      console.log('[Ordering Analysis]: Reservation transaction unblocked, detected status=booked, and was rejected with 409 PLOT_ALREADY_BOOKED.');
      const reserveError = resB2.output?.body?.error;
      if (reserveError !== 'PLOT_ALREADY_BOOKED') {
        throw new Error(`Expected reserve rejection error 'PLOT_ALREADY_BOOKED', got '${reserveError}'`);
      }
    } else if (statusBook === 201 && statusReserve === 201) {
      console.log('\n[Ordering Analysis]: Reservation transaction acquired lock first and committed reserved status.');
      console.log('[Ordering Analysis]: Booking transaction unblocked, committed booking, and marked the active reservation as superseded.');
      const supersededRes = dbRes2.find((r) => r.status === 'superseded');
      if (!supersededRes) {
        throw new Error(`Expected reservation to be marked 'superseded' by the winning booking! Found: ${JSON.stringify(dbRes2)}`);
      }
    } else {
      throw new Error(`Unexpected race outcome: Book=${statusBook}, Reserve=${statusReserve}`);
    }

    if (dbPlot2.status !== 'booked') {
      throw new Error(`Final plot status must be 'booked', got '${dbPlot2.status}'`);
    }
    if (dbBookings2.length !== 1) {
      throw new Error(`Expected exactly 1 booking row on plot, got ${dbBookings2.length}`);
    }

    console.log('\n>>> TEST 2 RESULT: 100% PASSED (Atomic row-level serialization between booking and reservation verified)\n');

    console.log('========================================================================');
    console.log(' RESERVATION CONCURRENCY & RACE VERIFICATION SUITE: ALL TESTS PASSED');
    console.log('========================================================================');
  } finally {
    await prisma.$disconnect();
  }
}

runReservationRaceSuite().catch((err) => {
  console.error('\n[FATAL ERROR IN RESERVATION RACE SUITE]:', err);
  process.exit(1);
});
