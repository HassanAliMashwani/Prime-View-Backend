const assert = require('assert');
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
  console.log('--- Testing Format Version 2 Approval on Localhost ---');

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

  const customerId = 'cust-1791638890685-8xrk';
  const bookingId = 'book-1791638890685-ek4j';

  const memberToken = jwt.sign(
    {
      sub: customerId,
      customerId,
      role: 'customer',
    },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  // Find a pending installment payment
  const pendingPayments = await scopedDb((tx) =>
    tx.paymentRecord.findMany({
      where: { bookingId, status: { in: ['pending', 'overdue'] } },
      take: 1,
    })
  );
  assert(pendingPayments.length > 0, 'Must have at least 1 pending payment');
  const targetPayment = pendingPayments[0];

  // Create pending receipt
  const rcptId = `v2-test-rcpt-${Date.now()}`;
  await scopedDb((tx) =>
    tx.receiptSubmission.create({
      data: {
        id: rcptId,
        customerId,
        bookingId,
        paymentKind: 'regular',
        paymentRecordId: targetPayment.id,
        amount: targetPayment.amount,
        paymentDate: new Date('2026-10-15'),
        depositoryBank: 'Meezan Bank Ltd',
        transactionRef: `TRX-V2-${Date.now()}`,
        status: 'pending',
        receiptFileUrl: 'https://primeview.storage/receipts/test-v2.jpg',
      },
    })
  );

  // Approve receipt with Idempotency-Key
  const idempKey = `v2-key-${Date.now()}`;
  const resApprove = await fetch(`${BASE_URL}/receipts/${rcptId}/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
      'Idempotency-Key': idempKey,
    },
    body: JSON.stringify({ notes: 'Testing Version 2 10-char receipt number' }),
  });

  const approveData = await resApprove.json();
  assert.strictEqual(resApprove.status, 200, `Approval should succeed, got ${resApprove.status}`);
  const slipNumber = approveData?.receipt?.slip?.slipNumber;
  console.log('Approved slipNumber:', slipNumber);
  console.log('slipNumberFormatVersion:', approveData?.receipt?.slipNumberFormatVersion);

  // 1. Confirm format is PV-SLIP-2026-10CHARS
  const V2_REGEX = /^PV-SLIP-2026-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/;
  assert(
    V2_REGEX.test(slipNumber),
    `Slip number "${slipNumber}" must match pattern PV-SLIP-2026-10CHARS (Base32, length 10)`
  );
  console.log(`✓ Format matches PV-SLIP-2026-10CHARS pattern: ${slipNumber}`);

  // 2. Confirm member Payments (GET /receipts/me) shows it
  const resMe = await fetch(`${BASE_URL}/receipts/me`, {
    headers: {
      Authorization: `Bearer ${memberToken}`,
    },
  });
  assert.strictEqual(resMe.status, 200, `Member receipts should return 200, got ${resMe.status}`);
  const meData = await resMe.json();
  const foundInMe = meData.receipts?.find((r) => r.slipNumber === slipNumber || r.slip?.slipNumber === slipNumber);
  assert(foundInMe, `New v2 slip ${slipNumber} must appear in member receipts / payments list`);
  console.log(`✓ Member Payments list includes new slip: ${foundInMe.slipNumber || foundInMe.slip?.slipNumber}`);

  // 3. Confirm public /verify/... shows it
  const resVerify = await fetch(`${BASE_URL}/receipts/verify/${slipNumber}`);
  assert.strictEqual(resVerify.status, 200, `Public verify should return 200, got ${resVerify.status}`);
  const verifyData = await resVerify.json();
  assert.strictEqual(verifyData.exists, true, 'Slip must exist in public verify');
  assert.strictEqual(verifyData.slipNumber, slipNumber, 'Slip number must match');
  console.log(`✓ Public /verify/${slipNumber} verified successfully: status=${verifyData.status}`);

  // 4. Confirm PV-SLIP-2026-9264 still opens
  const resOld = await fetch(`${BASE_URL}/receipts/verify/PV-SLIP-2026-9264`);
  assert.strictEqual(resOld.status, 200, `Old slip verify should return 200, got ${resOld.status}`);
  const oldData = await resOld.json();
  assert.strictEqual(oldData.exists, true, 'Old slip must exist');
  assert.strictEqual(oldData.slipNumber, 'PV-SLIP-2026-9264', 'Old slip number must match');
  console.log(`✓ PV-SLIP-2026-9264 still opens and verifies successfully`);

  console.log('\n=== VERSION 2 APPROVAL AND VERIFICATION PASSED! ===');
  console.log('Sample v2 Slip Number:', slipNumber);
}

run().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
}).finally(() => prisma.$disconnect());
