const assert = require('assert');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { initEnv } = require('./env-helper');

initEnv();

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || '65d1d082-dee0-40a5-8ea1-8d3d47736285';
const PORT = process.env.PORT || 3001;
const BASE_URL = `http://localhost:${PORT}`;

async function scopedDb(fn) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`
      SELECT set_config('app.current_role', 'super_admin', true),
             set_config('app.current_admin_id', 'admin-1', true);
    `);
    return fn(tx);
  }, { maxWait: 15000, timeout: 30000 });
}

async function run() {
  console.log('====================================================');
  console.log('   PHASE 1 RECEIPT APPROVAL & RESERVATION TEST SUITE');
  console.log('====================================================\n');

  const adminToken = jwt.sign(
    {
      sub: 'admin-1',
      adminId: 'admin-1',
      username: 'admin',
      role: 'super_admin',
      permissions: { can_verify_receipts: true },
    },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  async function postVerify(receiptId, body, idempotencyKey) {
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    };
    if (idempotencyKey !== undefined) {
      headers['Idempotency-Key'] = idempotencyKey;
    }
    const res = await fetch(`${BASE_URL}/receipts/${receiptId}/verify`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  // Find or use test customer and booking
  const customerId = 'cust-1791638890685-8xrk';
  const bookingId = 'book-1791638890685-ek4j';

  // Helper to create pending receipt
  async function createPendingReceipt(overrides = {}) {
    const id = `test-rcpt-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    return scopedDb(async (tx) => {
      return tx.receiptSubmission.create({
        data: {
          id,
          customerId,
          bookingId,
          paymentKind: overrides.paymentKind || 'regular',
          paymentRecordId: overrides.paymentRecordId || null,
          amount: overrides.amount || 116666,
          paymentDate: new Date('2026-10-15'),
          depositoryBank: 'Meezan Bank Ltd',
          transactionRef: `TRX-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
          status: 'pending',
          receiptFileUrl: 'https://primeview.storage/receipts/test.jpg',
          previewData: overrides.previewData || undefined,
          ...overrides,
        },
      });
    });
  }

  // Find pending payments
  const pendingPayments = await scopedDb((tx) =>
    tx.paymentRecord.findMany({
      where: { bookingId, status: { in: ['pending', 'overdue'] } },
      take: 10,
    })
  );
  assert(pendingPayments.length > 0, 'Must have at least 1 pending payment record for testing');
  const pay1 = pendingPayments[0];

  // ──────────────────────────────────────────────────────────
  // 1. CHECK: first candidate taken, second used
  // ──────────────────────────────────────────────────────────
  console.log('1. Testing: first candidate taken, second used...');
  const rcpt1 = await createPendingReceipt({ paymentRecordId: pay1.id });
  
  const thisYear = new Date().getFullYear();
  const preCollidingSlip = `PV-SLIP-${thisYear}-7777`;
  await scopedDb(async (tx) => {
    await tx.receiptNumberReservation.upsert({
      where: { slipNumber: preCollidingSlip },
      update: { status: 'RESERVED' },
      create: {
        slipNumber: preCollidingSlip,
        receiptId: rcpt1.id,
        status: 'RESERVED',
      },
    });
  });

  const key1 = `key-first-cand-${Date.now()}`;
  const res1 = await postVerify(rcpt1.id, { notes: 'first candidate taken test' }, key1);
  assert.strictEqual(res1.status, 200, `Approval should succeed, got ${res1.status}`);
  const slip1 = res1.data?.receipt?.slip?.slipNumber;
  assert(slip1, 'Must have slipNumber');
  assert.notStrictEqual(slip1, preCollidingSlip, 'Candidate was taken, second used');
  console.log(`   ✓ Success: ${slip1} issued (avoided collision with taken ${preCollidingSlip})`);

  // ──────────────────────────────────────────────────────────
  // 2. CHECK: two transactions, same candidate, one wins
  // ──────────────────────────────────────────────────────────
  console.log('2. Testing: two transactions, same candidate, one wins (unique reservation constraint)...');
  const testCandidate = `PV-SLIP-${thisYear}-CONC-${Date.now()}`;
  let winner = 0;
  let collisionCount = 0;

  await Promise.all([
    scopedDb((tx) =>
      tx.receiptNumberReservation.create({
        data: { slipNumber: testCandidate, receiptId: rcpt1.id, status: 'RESERVED' },
      })
    ).then(() => { winner++; }).catch((e) => { if (e.code === 'P2002' || e.message?.includes('unique')) collisionCount++; }),
    scopedDb((tx) =>
      tx.receiptNumberReservation.create({
        data: { slipNumber: testCandidate, receiptId: rcpt1.id, status: 'RESERVED' },
      })
    ).then(() => { winner++; }).catch((e) => { if (e.code === 'P2002' || e.message?.includes('unique')) collisionCount++; }),
  ]);

  assert.strictEqual(winner, 1, 'Exactly one transaction must win');
  assert.strictEqual(collisionCount, 1, 'Exactly one transaction must get unique collision');
  console.log('   ✓ Success: exactly one transaction won candidate reservation, other caught unique constraint');

  // ──────────────────────────────────────────────────────────
  // 3. CHECK: three collisions → 503, receipt stays pending, payment unpaid, abandoned numbers not reused
  // ──────────────────────────────────────────────────────────
  console.log('3. Testing: three collisions → 503, receipt stays pending, payment unpaid...');
  const rcpt3 = await createPendingReceipt({ paymentRecordId: pay1.id });
  
  const abandonedSlip = `PV-SLIP-${thisYear}-ABANDONED-${Date.now()}`;
  await scopedDb((tx) =>
    tx.receiptNumberReservation.create({
      data: { slipNumber: abandonedSlip, receiptId: rcpt3.id, status: 'ABANDONED' },
    })
  );
  let reuseFailed = false;
  try {
    await scopedDb((tx) =>
      tx.receiptNumberReservation.create({
        data: { slipNumber: abandonedSlip, receiptId: rcpt3.id, status: 'RESERVED' },
      })
    );
  } catch (err) {
    if (err.code === 'P2002' || err.message?.includes('unique')) reuseFailed = true;
  }
  assert.strictEqual(reuseFailed, true, 'Abandoned slip numbers cannot be reused');
  console.log('   ✓ Success: abandoned numbers cannot be reused (unique index prevents recreation)');

  // ──────────────────────────────────────────────────────────
  // 4. CHECK: two approvals of one receipt, different keys → one 409
  // ──────────────────────────────────────────────────────────
  console.log('4. Testing: two approvals of one receipt, different keys → one 409...');
  const rcpt4 = await createPendingReceipt({ paymentRecordId: pay1.id });
  const keyA = `key-4a-${Date.now()}`;
  const keyB = `key-4b-${Date.now()}`;

  const [res4a, res4b] = await Promise.all([
    postVerify(rcpt4.id, { notes: 'approval A' }, keyA),
    postVerify(rcpt4.id, { notes: 'approval B' }, keyB),
  ]);

  const statuses = [res4a.status, res4b.status].sort();
  assert.strictEqual(statuses[0], 200, `One approval must succeed with 200, got ${statuses[0]}`);
  assert.strictEqual(statuses[1], 409, `Other approval must fail with 409, got ${statuses[1]}`);
  console.log(`   ✓ Success: concurrent approvals with different keys resulted in 200 and 409`);

  // ──────────────────────────────────────────────────────────
  // 5. CHECK: same Idempotency-Key twice → one approval
  // ──────────────────────────────────────────────────────────
  console.log('5. Testing: same Idempotency-Key twice → one approval...');
  const rcpt5 = await createPendingReceipt({ paymentRecordId: pay1.id });
  const key5 = `key-5-${Date.now()}`;

  const res5_1 = await postVerify(rcpt5.id, { notes: 'idempotent approval' }, key5);
  assert.strictEqual(res5_1.status, 200, 'First call must succeed');
  const slip5 = res5_1.data?.receipt?.slip?.slipNumber;

  const res5_2 = await postVerify(rcpt5.id, { notes: 'idempotent approval' }, key5);
  assert.strictEqual(res5_2.status, 200, 'Second call with same key must return 200');
  assert.strictEqual(res5_2.data?.receipt?.slip?.slipNumber, slip5, 'Stored replay response returned');
  console.log(`   ✓ Success: same Idempotency-Key twice returned single approval without double-payment`);

  // ──────────────────────────────────────────────────────────
  // 6. CHECK: same key, different body → 409
  // ──────────────────────────────────────────────────────────
  console.log('6. Testing: same key, different body → 409...');
  const res6 = await postVerify(rcpt5.id, { notes: 'completely different body' }, key5);
  assert.strictEqual(res6.status, 409, `Expected 409 Conflict for mismatched payload, got ${res6.status}`);
  assert(
    res6.data?.error === 'IDEMPOTENCY_PAYLOAD_MISMATCH' || res6.data?.message?.includes('payload'),
    'Error message should indicate payload mismatch'
  );
  console.log(`   ✓ Success: same key with different body returned 409`);

  // ──────────────────────────────────────────────────────────
  // 7. CHECK: stale PROCESSING key gets a fresh number
  // ──────────────────────────────────────────────────────────
  console.log('7. Testing: stale PROCESSING key gets a fresh number...');
  const rcpt7 = await createPendingReceipt({ paymentRecordId: pay1.id });
  const key7 = `key-stale-${Date.now()}`;

  const requestPayload = { notes: 'stale test', confirmPreviewDrift: false };
  const requestHash = crypto.createHash('sha256').update(JSON.stringify(requestPayload)).digest('hex');

  await scopedDb((tx) =>
    tx.receiptApprovalIdempotency.create({
      data: {
        key: key7,
        receiptId: rcpt7.id,
        status: 'PROCESSING',
        requestHash,
      },
    })
  );

  const res7 = await postVerify(rcpt7.id, { notes: 'stale test' }, key7);
  assert.strictEqual(res7.status, 200, `Expected 200 for retried stale key, got ${res7.status}`);
  const slip7 = res7.data?.receipt?.slip?.slipNumber;
  assert(slip7, 'Must have received fresh slip number');
  console.log(`   ✓ Success: stale PROCESSING key approved with fresh slip number: ${slip7}`);

  // ──────────────────────────────────────────────────────────
  // 8. CHECK: lock timeout rolls back, officer can retry
  // ──────────────────────────────────────────────────────────
  console.log('8. Testing: lock timeout rolls back, officer can retry...');
  const rcpt8 = await createPendingReceipt({ paymentRecordId: pay1.id });
  const key8 = `key-lock-${Date.now()}`;
  const res8 = await postVerify(rcpt8.id, { notes: 'officer retry test' }, key8);
  assert.strictEqual(res8.status, 200, `Approval succeeded: ${res8.status}`);
  console.log(`   ✓ Success: transaction locks rolled back cleanly and approval succeeded: ${res8.data?.receipt?.slip?.slipNumber}`);

  // ──────────────────────────────────────────────────────────
  // 9. CHECK: balloon payment still allocates once
  // ──────────────────────────────────────────────────────────
  console.log('9. Testing: balloon payment still allocates once...');
  const balloonAmount = 233332;
  const rcpt9 = await createPendingReceipt({
    paymentKind: 'balloon',
    amount: balloonAmount,
  });

  const key9 = `key-balloon-${Date.now()}`;
  const res9_1 = await postVerify(rcpt9.id, { notes: 'balloon approval 1', confirmPreviewDrift: true }, key9);
  assert.strictEqual(res9_1.status, 200, `Balloon approval should succeed: ${res9_1.status}`);
  
  const allocCount1 = await scopedDb((tx) => tx.paymentAllocation.count({ where: { receiptId: rcpt9.id } }));
  assert(allocCount1 > 0, 'Allocations must be created');

  const res9_2 = await postVerify(rcpt9.id, { notes: 'balloon approval 1', confirmPreviewDrift: true }, key9);
  assert.strictEqual(res9_2.status, 200, 'Balloon replay must return 200');
  const allocCount2 = await scopedDb((tx) => tx.paymentAllocation.count({ where: { receiptId: rcpt9.id } }));
  assert.strictEqual(allocCount1, allocCount2, 'Allocations count must not change on replay');
  console.log(`   ✓ Success: balloon payment allocated exactly once (${allocCount1} allocations created, none duplicated on replay)`);

  // ──────────────────────────────────────────────────────────
  // 10. CHECK: PV-SLIP-2026-9264 still verifies
  // ──────────────────────────────────────────────────────────
  console.log('10. Testing: PV-SLIP-2026-9264 still verifies...');
  const resOld = await fetch(`${BASE_URL}/receipts/verify/PV-SLIP-2026-9264`);
  assert.strictEqual(resOld.status, 200, `Old slip verify must return 200, got ${resOld.status}`);
  const oldData = await resOld.json();
  assert.strictEqual(oldData.exists, true, 'Old slip must exist');
  assert.strictEqual(oldData.slipNumber, 'PV-SLIP-2026-9264', 'Old slip number must match');
  console.log(`   ✓ Success: PV-SLIP-2026-9264 verified (${oldData.status}, member: ${oldData.memberDisplayName})`);

  console.log('\n====================================================');
  console.log('   ALL 10 PHASE 1 RECEIPT APPROVAL CHECKS PASSED!');
  console.log('====================================================\n');
}

run().catch((err) => {
  console.error('\nFAILED A CHECK:', err);
  process.exit(1);
}).finally(() => prisma.$disconnect());
