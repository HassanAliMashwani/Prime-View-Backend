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
  console.log('--- Testing Flag Reverted to 1 on Localhost ---');

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
  const rcptId = `v1-test-rcpt-${Date.now()}`;
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
        transactionRef: `TRX-V1-${Date.now()}`,
        status: 'pending',
        receiptFileUrl: 'https://primeview.storage/receipts/test-v1.jpg',
      },
    })
  );

  // Approve receipt with Idempotency-Key
  const idempKey = `v1-key-${Date.now()}`;
  const resApprove = await fetch(`${BASE_URL}/receipts/${rcptId}/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
      'Idempotency-Key': idempKey,
    },
    body: JSON.stringify({ notes: 'Testing Version 1 four digit receipt number' }),
  });

  const approveData = await resApprove.json();
  assert.strictEqual(resApprove.status, 200, `Approval should succeed, got ${resApprove.status}`);
  const slipNumber = approveData?.receipt?.slip?.slipNumber;
  console.log('Approved slipNumber with flag 1:', slipNumber);
  console.log('slipNumberFormatVersion:', approveData?.receipt?.slipNumberFormatVersion);

  // Assert it is 4 digits format: PV-SLIP-YYYY-####
  const V1_REGEX = /^PV-SLIP-2026-\d{4}$/;
  assert(
    V1_REGEX.test(slipNumber),
    `Slip number "${slipNumber}" must match 4-digit format PV-SLIP-2026-####`
  );
  console.log(`✓ Confirmed next approval is four digits again: ${slipNumber}`);

  // Confirm version-2 test receipt was NOT rewritten:
  const v2Receipt = await scopedDb((tx) =>
    tx.receiptSubmission.findUnique({
      where: { slipNumber: 'PV-SLIP-2026-RSQM2FU94L' },
    })
  );
  assert(v2Receipt, 'Version-2 test receipt must still exist in DB');
  assert.strictEqual(v2Receipt.slipNumber, 'PV-SLIP-2026-RSQM2FU94L', 'Version-2 test receipt number not rewritten');
  assert.strictEqual(v2Receipt.slipNumberFormatVersion, 2, 'Version-2 test receipt formatVersion must still be 2');
  console.log(`✓ Confirmed version-2 test receipt was not rewritten: ${v2Receipt.slipNumber} (version ${v2Receipt.slipNumberFormatVersion})`);

  // Confirm PV-SLIP-2026-9264 still verifies
  const resOld = await fetch(`${BASE_URL}/receipts/verify/PV-SLIP-2026-9264`);
  assert.strictEqual(resOld.status, 200, `Old slip verify should return 200, got ${resOld.status}`);
  const oldData = await resOld.json();
  assert.strictEqual(oldData.exists, true, 'Old slip must exist');
  assert.strictEqual(oldData.slipNumber, 'PV-SLIP-2026-9264', 'Old slip number must match');
  console.log(`✓ PV-SLIP-2026-9264 still verifies successfully`);

  console.log('\n=== REVERT TO FLAG 1 VERIFICATION PASSED! ===');
}

run().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
}).finally(() => prisma.$disconnect());
