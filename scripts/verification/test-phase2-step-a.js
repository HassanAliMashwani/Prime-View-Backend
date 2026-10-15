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
  console.log('====================================================');
  console.log('   PHASE 2 STEP A: OPAQUE VERIFICATION TOKEN TEST');
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

  // 1. Create a pending receipt
  const rcptId = `p2a-test-rcpt-${Date.now()}`;
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
        transactionRef: `TRX-P2A-${Date.now()}`,
        status: 'pending',
        receiptFileUrl: 'https://primeview.storage/receipts/test-p2a.jpg',
      },
    })
  );
  console.log(`Created pending test receipt: ${rcptId}`);

  // 2. Approve receipt with Idempotency-Key
  const idempKey = `p2a-key-${Date.now()}`;
  const resApprove = await fetch(`${BASE_URL}/receipts/${rcptId}/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
      'Idempotency-Key': idempKey,
    },
    body: JSON.stringify({ notes: 'Testing Phase 2 Step A verification token' }),
  });

  const approveData = await resApprove.json();
  assert.strictEqual(resApprove.status, 200, `Approval should succeed, got ${resApprove.status}: ${JSON.stringify(approveData)}`);

  const receipt = approveData.receipt;
  const slip = receipt.slip;

  console.log('Approved slipNumber:', slip?.slipNumber);
  console.log('verificationToken:', receipt.verificationToken || slip?.verificationToken);
  console.log('qrTarget:', receipt.qrTarget || slip?.qrTarget);
  console.log('qrPayload:', slip?.qrPayload);

  // Assertions for Requirement 1:
  // "New approvals get verificationToken from crypto.randomBytes(32).toString('base64url'). Old receipts keep a null token."
  const token = receipt.verificationToken || slip?.verificationToken;
  assert(token, 'Must return a verificationToken');
  assert.strictEqual(typeof token, 'string', 'Token must be a string');
  // 32 bytes base64url is 43 characters long
  assert.strictEqual(token.length, 43, `Base64url token of 32 bytes must be 43 characters, got ${token.length}`);
  assert(/^[A-Za-z0-9_-]+$/.test(token), 'Token must be valid base64url characters only');

  // Assertions for Requirement 2:
  // "Store qrTarget. New QR uses PUBLIC_RECEIPT_VERIFY_ORIGIN plus /verify/ plus the token. If that env is missing on localhost, use http://localhost:3000. Never use 192.168.1.4. Do not refuse to start the server on localhost."
  const qrTarget = receipt.qrTarget || slip?.qrTarget;
  assert(qrTarget, 'Must store and return qrTarget');
  assert(!qrTarget.includes('192.168.1.4'), 'qrTarget must NEVER use 192.168.1.4');
  assert(
    qrTarget.startsWith('http://localhost:3000/verify/') || qrTarget.includes('/verify/' + token),
    `qrTarget must end with /verify/${token}, got ${qrTarget}`
  );
  assert.strictEqual(slip?.qrPayload, qrTarget, 'slip.qrPayload must match qrTarget');

  // Verify DB state
  const dbRow = await scopedDb((tx) => tx.receiptSubmission.findUnique({ where: { id: rcptId } }));
  assert(dbRow, 'Receipt must exist in DB');
  assert.strictEqual(dbRow.verificationToken, token, 'verificationToken must be stored in DB');
  assert.strictEqual(dbRow.qrTarget, qrTarget, 'qrTarget must be stored in DB');
  console.log('✓ Stored verificationToken and qrTarget verified in database');

  // Assertions for Requirement 3:
  // "Old slips such as PV-SLIP-2026-9264 keep their current /verify/PV-SLIP-... link. Old receipts keep a null token."
  const oldDbRow = await scopedDb((tx) => tx.receiptSubmission.findUnique({ where: { slipNumber: 'PV-SLIP-2026-9264' } }));
  assert(oldDbRow, 'Old receipt PV-SLIP-2026-9264 must exist in DB');
  assert.strictEqual(oldDbRow.verificationToken, null, 'Old receipts keep a null token');
  console.log('✓ Old receipt PV-SLIP-2026-9264 has verificationToken = null');

  const resOld = await fetch(`${BASE_URL}/receipts/verify/PV-SLIP-2026-9264`);
  assert.strictEqual(resOld.status, 200, `Old slip verify should return 200, got ${resOld.status}`);
  const oldData = await resOld.json();
  assert.strictEqual(oldData.exists, true, 'Old slip must exist');
  assert.strictEqual(oldData.slipNumber, 'PV-SLIP-2026-9264', 'Old slip number must match');
  console.log(`✓ PV-SLIP-2026-9264 still opens and verifies successfully`);

  // Verify new receipt also verifies via public verify by token
  const resVerifyToken = await fetch(`${BASE_URL}/receipts/verify/${token}`);
  assert.strictEqual(resVerifyToken.status, 200, `Verify by token should return 200, got ${resVerifyToken.status}`);
  const verifyTokenData = await resVerifyToken.json();
  assert.strictEqual(verifyTokenData.exists, true, 'New slip must exist when queried by token');
  assert.strictEqual(verifyTokenData.slipNumber, slip?.slipNumber, 'Slip number must match');
  console.log(`✓ New receipt successfully verified by token via public API: /verify/${token}`);

  console.log('\n====================================================');
  console.log('   ALL PHASE 2 STEP A CHECKS PASSED!');
  console.log('====================================================');
  console.log('\nNew Local qrTarget:', qrTarget);
}

run().catch((err) => {
  console.error('\nTest failed:', err);
  process.exit(1);
}).finally(() => prisma.$disconnect());
