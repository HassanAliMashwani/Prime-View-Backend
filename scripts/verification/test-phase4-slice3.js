const assert = require('assert');
const jwt = require('jsonwebtoken');
const { PrismaClient, Prisma } = require('@prisma/client');
const { initEnv } = require('./env-helper');

initEnv();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required.');
}
const BASE_URL = `http://localhost:${PORT}`;

async function scopedDb(fn) {
  for (let i = 0; i < 5; i++) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`
          SELECT set_config('app.current_role', 'super_admin', true),
                 set_config('app.current_admin_id', 'admin-1', true);
        `);
        return fn(tx);
      }, { maxWait: 15000, timeout: 30000 });
    } catch (e) {
      if (i === 4) throw e;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

async function run() {
  console.log('====================================================');
  console.log('   PHASE 4 SLICE 3: RECEIPT CANCELLATION TESTS');
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

  // 1. Find an unpaid installment payment record NOT in [2, 23]
  const targetPayment = await scopedDb(async (tx) => {
    return tx.paymentRecord.findFirst({
      where: {
        status: { in: ['pending', 'overdue'] },
        feeType: 'plot_installment',
        NOT: { installmentNumber: { in: [2, 23] } },
      },
      include: {
        booking: {
          include: {
            plot: true,
            customer: true,
          },
        },
      },
      orderBy: { installmentNumber: 'asc' },
    });
  });

  assert(targetPayment, 'Must find an unpaid installment (not 2 and not 23)');
  console.log(`Found target payment:`);
  console.log(`- Payment ID: ${targetPayment.id}`);
  console.log(`- Installment #: ${targetPayment.installmentNumber}`);
  console.log(`- Amount: PKR ${targetPayment.amount}`);
  console.log(`- Status: ${targetPayment.status}`);
  console.log(`- Due Date: ${targetPayment.dueDate}`);
  console.log(`- Booking ID: ${targetPayment.bookingId}`);
  console.log(`- Plot ID: ${targetPayment.booking.plot.id} (Status: ${targetPayment.booking.plot.status})`);

  const initialPlotStatus = targetPayment.booking.plot.status;
  const initialBookingId = targetPayment.bookingId;
  const initialCustomerId = targetPayment.booking.customerId;

  // 2. Create a new pending receipt
  const receiptId = `p4-test-rcpt-${Date.now()}`;
  const trxRef = `TRX-P4-CANCEL-${Date.now()}`;
  const paymentDate = new Date('2026-10-16T10:00:00.000Z');

  await scopedDb(async (tx) => {
    return tx.receiptSubmission.create({
      data: {
        id: receiptId,
        customerId: initialCustomerId,
        bookingId: initialBookingId,
        paymentRecordId: targetPayment.id,
        amount: targetPayment.amount,
        paymentDate,
        depositoryBank: 'Meezan Bank Ltd',
        transactionRef: trxRef,
        paymentKind: 'regular',
        status: 'pending',
        receiptFileUrl: 'https://primeview.storage/receipts/test-p4-cancel.jpg',
      },
    });
  });
  console.log(`\nCreated pending test receipt: ${receiptId}`);

  // 3. Approve receipt via POST /receipts/:id/verify
  console.log(`Approving receipt ${receiptId}...`);
  const approvalIdempKey = `approve-${Date.now()}`;
  const resApprove = await fetch(`${BASE_URL}/receipts/${receiptId}/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
      'Idempotency-Key': approvalIdempKey,
    },
    body: JSON.stringify({ notes: 'Phase 4 Slice 3 approval before cancellation' }),
  });

  const approveData = await resApprove.json();
  if (resApprove.status !== 200) {
    console.error(`Approval failed with status ${resApprove.status}:`, approveData);
    process.exit(1);
  }

  const newSlipNumber = approveData.receipt?.slipNumber;
  console.log(`Approval succeeded! Generated slipNumber: ${newSlipNumber}`);
  assert(newSlipNumber, 'Slip number must be generated on approval');
  assert(newSlipNumber !== 'PV-SLIP-2026-9264', 'Must not touch 9264');
  assert(newSlipNumber !== 'PV-SLIP-2026-1888', 'Must not touch 1888');

  // Verify payment is paid in DB
  const paymentAfterApproval = await scopedDb(async (tx) => {
    return tx.paymentRecord.findUnique({ where: { id: targetPayment.id } });
  });
  assert.strictEqual(paymentAfterApproval.status, 'paid', 'Payment should be paid after approval');
  assert.strictEqual(Number(paymentAfterApproval.paidAmount), Number(targetPayment.amount));

  // 4. Cancel the newly verified receipt inside the same test
  console.log(`\nCancelling newly approved receipt ${receiptId} (${newSlipNumber})...`);
  const cancelIdempKey = `cancel-${Date.now()}`;
  const cancelPayload = {
    reasonCode: 'duplicate_receipt',
    reason: 'Duplicate teller voucher posted by accounting during audit reconciliation',
  };

  const resCancel = await fetch(`${BASE_URL}/receipts/${receiptId}/cancel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
      'Idempotency-Key': cancelIdempKey,
    },
    body: JSON.stringify(cancelPayload),
  });

  const cancelData = await resCancel.json();
  if (resCancel.status !== 200) {
    console.error(`CANCELLATION FAILED for newly created slip ${newSlipNumber}:`, cancelData);
    console.log(`Reported new slip number: ${newSlipNumber}`);
    process.exit(1);
  }

  console.log(`Cancellation succeeded! Response:`, JSON.stringify(cancelData, null, 2));

  // 5. Test idempotency replay with same key
  console.log(`\nTesting idempotency replay with same key (${cancelIdempKey})...`);
  const resReplay = await fetch(`${BASE_URL}/receipts/${receiptId}/cancel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
      'Idempotency-Key': cancelIdempKey,
    },
    body: JSON.stringify(cancelPayload),
  });
  const replayData = await resReplay.json();
  assert.strictEqual(resReplay.status, 200, 'Replayed idempotency key must return 200');
  assert.strictEqual(replayData.receipt?.status, 'cancelled');
  console.log(`Idempotency replay returned same successful response without error.`);

  // 6. Test second cancellation with a NEW idempotency key -> MUST return 409
  console.log(`\nTesting second cancellation with a new idempotency key (expecting HTTP 409)...`);
  const resSecondCancel = await fetch(`${BASE_URL}/receipts/${receiptId}/cancel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
      'Idempotency-Key': `cancel-second-${Date.now()}`,
    },
    body: JSON.stringify({
      reasonCode: 'administrative_error',
      reason: 'Attempting to cancel an already cancelled receipt',
    }),
  });
  const secondCancelData = await resSecondCancel.json();
  console.log(`Second cancel HTTP Status: ${resSecondCancel.status}`);
  console.log(`Second cancel response body:`, JSON.stringify(secondCancelData, null, 2));
  assert.strictEqual(resSecondCancel.status, 409, 'Second cancellation must return HTTP 409');

  // 7. Test public verify response for cancelled receipt
  console.log(`\nTesting public verify for cancelled slip ${newSlipNumber}...`);
  const resPublic = await fetch(`${BASE_URL}/receipts/verify/${newSlipNumber}`);
  const publicJson = await resPublic.json();
  console.log(`Public verify response:`, JSON.stringify(publicJson, null, 2));

  assert.strictEqual(resPublic.status, 200);
  assert.strictEqual(publicJson.exists, true);
  assert.strictEqual(publicJson.status, 'cancelled');
  assert.strictEqual(publicJson.slipNumber, newSlipNumber);
  assert(publicJson.cancelledAt, 'cancelledAt must be present in cancelled public response');

  // Must ONLY have exists, status, slipNumber, cancelledAt
  const publicKeys = Object.keys(publicJson).sort();
  console.log(`Public JSON keys:`, publicKeys);
  assert.deepStrictEqual(publicKeys, ['cancelledAt', 'exists', 'slipNumber', 'status'].sort());
  assert.strictEqual(publicJson.amount, undefined, 'Amount must not be present in public JSON');
  assert.strictEqual(publicJson.memberDisplayName, undefined, 'Member name must not be present in public JSON');
  assert.strictEqual(publicJson.cnic, undefined, 'CNIC must not be present in public JSON');
  assert.strictEqual(publicJson.cancellationReason, undefined, 'Private reason must NOT appear in public JSON');

  // 8. Inspect payment row in DB
  console.log(`\nInspecting payment row in DB...`);
  const paymentAfterCancel = await scopedDb(async (tx) => {
    return tx.paymentRecord.findUnique({ where: { id: targetPayment.id } });
  });
  console.log(`Payment row after cancellation:`, {
    id: paymentAfterCancel.id,
    installmentNumber: paymentAfterCancel.installmentNumber,
    amount: paymentAfterCancel.amount,
    paidAmount: paymentAfterCancel.paidAmount,
    paidDate: paymentAfterCancel.paidDate,
    transactionRef: paymentAfterCancel.transactionRef,
    status: paymentAfterCancel.status,
    dueDate: paymentAfterCancel.dueDate,
  });

  assert.strictEqual(Number(paymentAfterCancel.paidAmount), 0, 'paidAmount must be 0');
  assert.strictEqual(paymentAfterCancel.paidDate, null, 'paidDate must be null');
  assert.strictEqual(paymentAfterCancel.transactionRef, null, 'transactionRef must be null');

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const expectedPaymentStatus = (paymentAfterCancel.dueDate && new Date(paymentAfterCancel.dueDate) < startOfToday) ? 'overdue' : 'pending';
  assert.strictEqual(paymentAfterCancel.status, expectedPaymentStatus, `Payment status must be ${expectedPaymentStatus}`);

  // 9. Inspect Plot status
  console.log(`\nInspecting plot status in DB...`);
  const plotAfterCancel = await scopedDb(async (tx) => {
    return tx.plot.findUnique({ where: { id: targetPayment.booking.plot.id } });
  });
  console.log(`Plot status before: ${initialPlotStatus}, Plot status after: ${plotAfterCancel.status}`);
  assert.strictEqual(plotAfterCancel.status, initialPlotStatus, 'Plot status must be unchanged');

  // 10. Inspect AuditEntry
  console.log(`\nInspecting AuditEntry in DB...`);
  const auditEntries = await scopedDb(async (tx) => {
    return tx.auditEntry.findMany({
      where: {
        entityId: receiptId,
        action: 'RECEIPT_CANCELLED',
      },
    });
  });
  assert(auditEntries.length >= 1, 'AuditEntry for RECEIPT_CANCELLED must exist');
  const audit = auditEntries[0];
  console.log(`AuditEntry found:`, {
    action: audit.action,
    entityType: audit.entityType,
    entityId: audit.entityId,
    details: audit.details,
    newValue: audit.newValue,
  });
  assert(audit.details.includes('duplicate_receipt'));
  assert(audit.details.includes(cancelPayload.reason));

  // 11. Verify PV-SLIP-2026-9264 is untouched and still verified
  console.log(`\nVerifying PV-SLIP-2026-9264...`);
  const res9264 = await fetch(`${BASE_URL}/receipts/verify/PV-SLIP-2026-9264`);
  const json9264 = await res9264.json();
  console.log(`9264 public JSON:`, JSON.stringify(json9264, null, 2));
  assert.strictEqual(res9264.status, 200);
  assert.strictEqual(json9264.exists, true);
  assert.strictEqual(json9264.status, 'verified');
  assert.strictEqual(json9264.hashKeyVersion, null);

  console.log('\n====================================================');
  console.log('   ALL PHASE 4 SLICE 3 ASSERTIONS PASSED!');
  console.log('====================================================\n');
}

run().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
