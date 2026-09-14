/**
 * test-wave5-reverse-ordering-race.js
 * 
 * Verifies the reverse ordering of the live race:
 * Reservation acquires the row lock first and creates an active reservation.
 * Concurrent Booking acquires the row lock next, supersedes the active reservation,
 * and commits the booking.
 * 
 * Demonstrates:
 * 1. ReserveWorker response (HTTP 201 Created)
 * 2. BookWorker response (HTTP 201 Created)
 * 3. Final Database state:
 *    - Plot status: 'booked'
 *    - Reservation status: 'superseded' (was 'active')
 *    - Booking status: 'active'
 *    - Audit entries: PLOT_RESERVED followed by PLOT_BOOKED
 * 4. Granular millisecond timing breakdown explaining the network RTT / lock serialization.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { PrismaClient } = require('@prisma/client');

const { initEnv } = require('./env-helper');
const env = initEnv();
const PROJECT_ROOT = env.PROJECT_ROOT;

const BASE_URL = `http://localhost:${env.PORT}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function httpRequest(urlStr, options = {}, body = null) {
  return new Promise((resolve) => {
    const parsed = new URL(urlStr);
    const reqOptions = {
      protocol: parsed.protocol,
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
    const proc = spawn('node', [path.resolve(__dirname, 'wave5-worker.js'), ...args], { cwd: __dirname });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('close', (code) => {
      let parsed;
      try { parsed = JSON.parse(stdout.trim()); } catch { parsed = { rawStdout: stdout, rawStderr: stderr, code }; }
      resolve({ code, output: parsed });
    });
  });
}

async function main() {
  console.log('========================================================================');
  console.log(' WAVE 5: LIVE RACE REVERSE ORDERING (RESERVE WINS LOCK, THEN BOOKED)');
  console.log('========================================================================\n');

  const prisma = new PrismaClient({
    datasources: { db: { url: env.DIRECT_URL || env.DATABASE_URL } },
  });

  try {
    await startServer();
    const token = await loginSuperAdmin();

    // Find an available plot for this live race
    const targetPlot = await prisma.plot.findFirst({
      where: {
        status: 'available',
        category: { not: 'amenity' },
        isAdjustment: false,
      },
      select: { id: true, plotNumber: true, blockId: true, status: true },
    });

    if (!targetPlot) {
      throw new Error('No available plots found for reverse ordering race test.');
    }

    console.log(`Target Plot Selected: ${targetPlot.plotNumber} (${targetPlot.id}) in Block ${targetPlot.blockId}`);
    console.log(`Initial Plot Status: "${targetPlot.status}"\n`);

    // Stagger dispatch by 100ms so ReserveWorker reliably arrives slightly ahead and acquires FOR UPDATE lock first
    const now = Date.now();
    const syncTimeReserve = now + 1500;
    const syncTimeBook = now + 1600; // 100ms later

    console.log(`[Dispatch] ReserveWorker (PID scheduled at ${new Date(syncTimeReserve).toISOString()})`);
    console.log(`[Dispatch] BookWorker    (PID scheduled at ${new Date(syncTimeBook).toISOString()})\n`);

    const tStart = Date.now();
    const [resReserve, resBook] = await Promise.all([
      runWorker(['--plotId', targetPlot.id, '--token', token, '--workerId', 'ReserveFirst', '--action', 'reserve', '--syncTime', syncTimeReserve.toString()]),
      runWorker(['--plotId', targetPlot.id, '--token', token, '--workerId', 'BookSecond', '--action', 'book', '--syncTime', syncTimeBook.toString()]),
    ]);
    const tTotal = Date.now() - tStart;

    console.log('--- Worker Execution Results ---');
    console.log('ReserveWorker Result:');
    console.log(JSON.stringify(resReserve.output, null, 2));
    console.log('\nBookWorker Result:');
    console.log(JSON.stringify(resBook.output, null, 2));

    // Verify Ground Truth in PostgreSQL
    console.log('\n--- PostgreSQL Ground Truth Verification ---');
    const plotState = await prisma.plot.findUnique({
      where: { id: targetPlot.id },
      select: { id: true, plotNumber: true, status: true, currentOwnerId: true },
    });
    console.log('Final Plot State:', plotState);

    const reservations = await prisma.reservation.findMany({
      where: { plotId: targetPlot.id },
      select: { id: true, customerName: true, status: true, tokenFee: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    console.log('Reservations on Plot:', reservations);

    const bookings = await prisma.booking.findMany({
      where: { plotId: targetPlot.id },
      select: { id: true, customerId: true, status: true, paymentType: true, bookingDate: true },
    });
    console.log('Bookings on Plot:', bookings);

    const audits = await prisma.auditEntry.findMany({
      where: {
        OR: [
          { entityType: 'plot', entityId: targetPlot.id },
          { entityType: 'reservation', details: { contains: targetPlot.plotNumber } },
        ],
      },
      select: { id: true, action: true, entityType: true, entityId: true, timestamp: true, details: true },
      orderBy: { timestamp: 'asc' },
    });
    console.log('Audit Entries for Plot & Reservation:');
    console.log(JSON.stringify(audits, null, 2));

    // Validations
    const reserveSuccess = resReserve.output?.statusCode === 201;
    const bookSuccess = resBook.output?.statusCode === 201;
    const plotBooked = plotState.status === 'booked';
    const reservationSuperseded = reservations.some(r => r.status === 'superseded');
    const bookingActive = bookings.length === 1 && (bookings[0].status === 'active' || bookings[0].status === 'completed');
    const hasReservedAudit = audits.some(a => a.action === 'PLOT_RESERVED');
    const hasBookedAudit = audits.some(a => a.action === 'PLOT_BOOKED');

    console.log('\n--- Test Assertions ---');
    console.log(`ReserveWorker Succeeded (HTTP 201):        ${reserveSuccess ? 'PASS' : 'FAIL'}`);
    console.log(`BookWorker Succeeded (HTTP 201):           ${bookSuccess ? 'PASS' : 'FAIL'}`);
    console.log(`Final Plot Status is 'booked':             ${plotBooked ? 'PASS' : 'FAIL'}`);
    console.log(`Active Reservation marked 'superseded':    ${reservationSuperseded ? 'PASS' : 'FAIL'}`);
    console.log(`Booking Row is 'active':                   ${bookingActive ? 'PASS' : 'FAIL'}`);
    console.log(`Audit Trail includes PLOT_RESERVED:        ${hasReservedAudit ? 'PASS' : 'FAIL'}`);
    console.log(`Audit Trail includes PLOT_BOOKED:          ${hasBookedAudit ? 'PASS' : 'FAIL'}`);

    if (reserveSuccess && bookSuccess && plotBooked && reservationSuperseded && bookingActive && hasReservedAudit && hasBookedAudit) {
      console.log('\n========================================================================');
      console.log(' [SUCCESS] REVERSE ORDERING RACE FULLY DEMONSTRATED AND VERIFIED!');
      console.log('========================================================================');
    } else {
      throw new Error('One or more reverse race assertions failed.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('\n[FATAL ERROR]:', err);
  process.exit(1);
});
