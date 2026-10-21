const assert = require('assert');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { PrismaClient, Prisma } = require('@prisma/client');
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
  console.log('   PHASE 3 SLICE 1: HMAC RECEIPT SIGNING TEST');
  console.log('====================================================\n');

  const adminToken = jwt.sign(
    {
      sub: 'admin-1',
      adminId: 'admin-1',
      username: 'admin',
      fullName: 'Chief Secretariat Officer',
      role: 'super_admin',
      permissions: { can_verify_receipts: true },
    },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  const customerId = 'cust-1791638890685-8xrk';
  const bookingId = 'book-1791638890685-ek4j';

  // Check or create a payment record
  let targetPayment = await scopedDb((tx) =>
    tx.paymentRecord.findFirst({
      where: { bookingId, status: { in: ['pending', 'overdue', 'partially_paid'] } },
    })
  );

  if (!targetPayment) {
    console.log('Creating a new test installment payment record...');
    const maxInst = await scopedDb((tx) =>
      tx.paymentRecord.aggregate({
        where: { bookingId },
        _max: { installmentNumber: true },
      })
    );
    const nextInstNumber = (maxInst._max.installmentNumber || 27) + 1;
    targetPayment = await scopedDb((tx) =>
      tx.paymentRecord.create({
        data: {
          id: `pay-test-p3-${Date.now()}`,
          bookingId,
          feeType: 'plot_installment',
          installmentNumber: nextInstNumber,
          amount: new Prisma.Decimal('50000.00'),
          paidAmount: new Prisma.Decimal('0.00'),
          dueDate: new Date('2026-11-01'),
          status: 'pending',
        },
      })
    );
  }

  console.log(`Using target payment record: ${targetPayment.id} (Inst #${targetPayment.installmentNumber})`);

  // 1. Create a pending receipt
  const rcptId = `p3-test-rcpt-${Date.now()}`;
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
        depositoryBank: 'Habib Bank Ltd',
        transactionRef: `TRX-P3-${Date.now()}`,
        status: 'pending',
        receiptFileUrl: 'https://primeview.storage/receipts/test-p3.jpg',
      },
    })
  );
  console.log(`Created pending test receipt: ${rcptId}`);

  // 2. Approve receipt via POST /receipts/:id/verify
  const idempKey = `p3-key-${Date.now()}`;
  const resApprove = await fetch(`${BASE_URL}/receipts/${rcptId}/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
      'Idempotency-Key': idempKey,
    },
    body: JSON.stringify({ notes: 'Testing Phase 3 HMAC receipt signing' }),
  });

  const approveData = await resApprove.json();
  assert.strictEqual(resApprove.status, 200, `Approval should succeed, got ${resApprove.status}: ${JSON.stringify(approveData)}`);

  const receipt = approveData.receipt;
  const slipNumber = receipt.slipNumber;
  console.log(`\nApproved Test Receipt:`);
  console.log(`- Slip Number: ${slipNumber}`);
  console.log(`- HashKeyVersion: ${receipt.hashKeyVersion}`);
  console.log(`- SecurityHashDisplay: ${receipt.securityHashDisplay}`);
  console.log(`- SecurityHash: ${receipt.securityHash}`);

  // Assertions on approval response
  assert.strictEqual(receipt.hashKeyVersion, 1, 'hashKeyVersion must be 1 on approval response');
  assert(receipt.securityHashDisplay, 'securityHashDisplay must be present');
  assert.strictEqual(receipt.securityHashDisplay.length, 16, 'securityHashDisplay must be 16 characters');
  assert.strictEqual(approveData.integrityHash, undefined, 'Approval payload must NOT leak integrityHash');
  assert.strictEqual(receipt.integrityHash, undefined, 'Receipt object must NOT leak integrityHash');

  // 3. Inspect DB row
  const dbRow = await scopedDb((tx) =>
    tx.receiptSubmission.findUnique({ where: { id: rcptId } })
  );
  assert(dbRow, 'Receipt must exist in DB');
  assert.strictEqual(dbRow.hashKeyVersion, 1, 'DB hashKeyVersion must be 1');
  assert(dbRow.integrityHash, 'DB integrityHash must be present');
  assert.strictEqual(dbRow.integrityHash.length, 64, 'DB integrityHash must be 64-character SHA-256 hex string');
  assert.strictEqual(dbRow.integrityHash.substring(0, 16), receipt.securityHashDisplay, 'securityHashDisplay must match first 16 chars of DB integrityHash');

  // Verify all snapshot columns in DB
  console.log('\nVerifying DB Snapshots:');
  console.log(`- memberNameSnapshot: ${dbRow.memberNameSnapshot}`);
  console.log(`- membershipNumberSnapshot: ${dbRow.membershipNumberSnapshot}`);
  console.log(`- cnicLast4Snapshot: ${dbRow.cnicLast4Snapshot}`);
  console.log(`- plotNumberSnapshot: ${dbRow.plotNumberSnapshot}`);
  console.log(`- blockNameSnapshot: ${dbRow.blockNameSnapshot}`);
  console.log(`- amountSnapshot: ${dbRow.amountSnapshot}`);
  console.log(`- paymentDateSnapshot: ${dbRow.paymentDateSnapshot}`);
  console.log(`- paymentRecordIdSnapshot: ${dbRow.paymentRecordIdSnapshot}`);
  console.log(`- issuedByNameSnapshot: ${dbRow.issuedByNameSnapshot}`);
  console.log(`- issuedAtSnapshot: ${dbRow.issuedAtSnapshot?.toISOString()}`);

  assert(dbRow.memberNameSnapshot, 'memberNameSnapshot must be saved');
  assert(dbRow.membershipNumberSnapshot, 'membershipNumberSnapshot must be saved');
  assert(dbRow.cnicLast4Snapshot, 'cnicLast4Snapshot must be saved');
  assert(dbRow.plotNumberSnapshot, 'plotNumberSnapshot must be saved');
  assert(dbRow.blockNameSnapshot, 'blockNameSnapshot must be saved');
  assert(dbRow.amountSnapshot, 'amountSnapshot must be saved');
  assert(dbRow.paymentDateSnapshot, 'paymentDateSnapshot must be saved');
  assert(dbRow.paymentRecordIdSnapshot, 'paymentRecordIdSnapshot must be saved');
  assert(dbRow.issuedByNameSnapshot, 'issuedByNameSnapshot must be saved');
  assert(dbRow.issuedAtSnapshot, 'issuedAtSnapshot must be saved');

  // Verify HMAC computation directly with secret
  const hmacSecret = process.env.RECEIPT_HMAC_SECRET_V1;
  assert(hmacSecret, 'RECEIPT_HMAC_SECRET_V1 must be in process.env');

  const amountPaisa = new Prisma.Decimal(dbRow.amount).mul(100).toFixed(0);
  const paymentDateStr = dbRow.paymentDate.toISOString().split('T')[0];
  const issuedAtIso = dbRow.issuedAtSnapshot.toISOString();

  // v=1|receiptId=|slipNumber=|memberId=|memberName=|membershipNumber=|amountPaisa=|paymentDate=|plotId=|plotNumber=|paymentRecordId=|issuedByAdminId=|issuedByName=|issuedAt=
  const booking = await scopedDb((tx) =>
    tx.booking.findUnique({ where: { id: bookingId } })
  );

  const canonicalString = [
    'v=1',
    `receiptId=${rcptId}`,
    `slipNumber=${slipNumber}`,
    `memberId=${customerId}`,
    `memberName=${dbRow.memberNameSnapshot}`,
    `membershipNumber=${dbRow.membershipNumberSnapshot}`,
    `amountPaisa=${amountPaisa}`,
    `paymentDate=${paymentDateStr}`,
    `plotId=${booking.plotId}`,
    `plotNumber=${dbRow.plotNumberSnapshot}`,
    `paymentRecordId=${dbRow.paymentRecordIdSnapshot}`,
    `issuedByAdminId=admin-1`,
    `issuedByName=${dbRow.issuedByNameSnapshot}`,
    `issuedAt=${issuedAtIso}`,
  ].join('|');

  console.log(`\nCanonical String:`);
  console.log(canonicalString);

  const expectedHmac = crypto.createHmac('sha256', hmacSecret).update(canonicalString, 'utf8').digest('hex');
  assert(
    crypto.timingSafeEqual(Buffer.from(dbRow.integrityHash, 'utf8'), Buffer.from(expectedHmac, 'utf8')),
    'timingSafeEqual comparison must pass between stored integrityHash and expected HMAC'
  );
  console.log('✓ HMAC verification with timingSafeEqual succeeded!');

  // 4. Test Public Verify of the new signed receipt
  console.log(`\nQuerying public GET /receipts/verify/${slipNumber}...`);
  const resPublicNew = await fetch(`${BASE_URL}/receipts/verify/${slipNumber}`);
  assert.strictEqual(resPublicNew.status, 200, `Public verify should return 200, got ${resPublicNew.status}`);
  const publicNewData = await resPublicNew.json();

  console.log('Public New Slip JSON:', JSON.stringify(publicNewData, null, 2));

  assert.strictEqual(publicNewData.exists, true, 'Slip must exist in public verify');
  assert.strictEqual(publicNewData.slipNumber, slipNumber, 'Slip number must match');
  assert.strictEqual(publicNewData.status, 'verified', 'Slip status must be verified');
  assert.strictEqual(publicNewData.hashKeyVersion, 1, 'Public JSON must include hashKeyVersion = 1');
  assert.strictEqual(publicNewData.securityHashDisplay, dbRow.integrityHash.substring(0, 16), 'Public JSON securityHashDisplay must be first 16 hex chars');
  assert.strictEqual(publicNewData.integrityHash, undefined, 'Public JSON must NOT contain integrityHash');
  assert.strictEqual(publicNewData.RECEIPT_HMAC_SECRET_V1, undefined, 'Public JSON must NOT contain secret');
  assert.strictEqual(publicNewData.secret, undefined, 'Public JSON must NOT contain secret');
  console.log('✓ Public JSON verified: Has securityHashDisplay (16 hex), hashKeyVersion (1), NO integrityHash, NO secret');

  // 5. Test Public Verify of old receipt PV-SLIP-2026-9264
  console.log(`\nQuerying public GET /receipts/verify/PV-SLIP-2026-9264...`);
  const resPublicOld = await fetch(`${BASE_URL}/receipts/verify/PV-SLIP-2026-9264`);
  assert.strictEqual(resPublicOld.status, 200, `Old slip verify should return 200, got ${resPublicOld.status}`);
  const publicOldData = await resPublicOld.json();

  console.log('Public Old Slip JSON:', JSON.stringify(publicOldData, null, 2));

  assert.strictEqual(publicOldData.exists, true, 'Old slip must exist');
  assert.strictEqual(publicOldData.status, 'verified', 'Old slip status must be verified (GENUINE & VERIFIED)');
  assert.strictEqual(publicOldData.slipNumber, 'PV-SLIP-2026-9264', 'Old slip number must match');
  assert.strictEqual(publicOldData.securityHash, 'PV-SEC-A08E-46B1-3239', 'Old securityHash must be preserved');
  assert.strictEqual(publicOldData.securityHashDisplay, 'PV-SEC-A08E-46B1-3239', 'Old securityHashDisplay must match existing securityHash');
  assert.strictEqual(publicOldData.hashKeyVersion, null, 'Old slip hashKeyVersion must be null');
  assert.strictEqual(publicOldData.integrityHash, undefined, 'Old slip must NOT have integrityHash');
  assert.strictEqual(publicOldData.secret, undefined, 'Old slip must NOT have secret');
  console.log('✓ PV-SLIP-2026-9264 still verifies with GENUINE & VERIFIED, securityHash preserved, integrityHash null, no secret');

  console.log('\n====================================================');
  console.log('   ALL PHASE 3 SLICE 1 VERIFICATIONS PASSED!');
  console.log('====================================================');
}

run()
  .catch((e) => {
    console.error('Error during test:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
