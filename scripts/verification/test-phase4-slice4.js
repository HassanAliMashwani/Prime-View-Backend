const assert = require('assert');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { initEnv } = require('./env-helper');

const env = initEnv();
const PORT = env.PORT || 3001;
const BASE_URL = `http://localhost:${PORT}`;

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required.');
}

const prisma = new PrismaClient();

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
  console.log('   PHASE 4 SLICE 4: RECEIPT REPLACEMENT TESTS');
  console.log('====================================================\n');

  let originalSlipNumber = null;
  let newSlipNumber = null;

  try {
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

    // 1. Verify installment 24 is pending and paidAmount is 0
    console.log('--- Step 0: Inspect Installment 24 ---');
    const targetPayment = await scopedDb(async (tx) => {
      return tx.paymentRecord.findFirst({
        where: { installmentNumber: 24 },
        include: {
          booking: {
            include: {
              plot: true,
              customer: true,
            },
          },
        },
      });
    });

    assert(targetPayment, 'Must find payment record for installment 24');
    console.log(`Payment ID: ${targetPayment.id}`);
    console.log(`Installment #: ${targetPayment.installmentNumber}`);
    console.log(`Amount: PKR ${targetPayment.amount}`);
    console.log(`Status: ${targetPayment.status}`);
    console.log(`Paid Amount: ${targetPayment.paidAmount}`);
    console.log(`Plot: ${targetPayment.booking.plot.plotNumber} (Status: ${targetPayment.booking.plot.status})`);

    assert.strictEqual(targetPayment.status, 'pending', 'Installment 24 status must be pending');
    assert.strictEqual(Number(targetPayment.paidAmount), 0, 'Installment 24 paidAmount must be 0');
    assert.strictEqual(targetPayment.booking.plot.status, 'booked', 'Plot status must be booked');

    const initialPlotStatus = targetPayment.booking.plot.status;
    const initialBookingId = targetPayment.bookingId;
    const initialCustomerId = targetPayment.booking.customerId;
    const installmentAmount = Number(targetPayment.amount);

    // 2. Step 1: Approve one new receipt
    console.log('\n--- Step 1: Approve One New Receipt ---');
    const origReceiptId = `p4-s4-orig-${Date.now()}`;
    const origTrxRef = `TRX-P4-REPLACE-${Date.now()}`;
    const paymentDate = new Date('2026-10-16T10:00:00.000Z');

    await scopedDb(async (tx) => {
      return tx.receiptSubmission.create({
        data: {
          id: origReceiptId,
          customerId: initialCustomerId,
          bookingId: initialBookingId,
          paymentRecordId: targetPayment.id,
          amount: targetPayment.amount,
          paymentDate,
          depositoryBank: 'Meezan Bank Ltd',
          transactionRef: origTrxRef,
          paymentKind: 'regular',
          status: 'pending',
          receiptFileUrl: 'https://primeview.storage/receipts/test-p4-replace.jpg',
        },
      });
    });

    const approvalIdempKey = `approve-${Date.now()}`;
    const resApprove = await fetch(`${BASE_URL}/receipts/${origReceiptId}/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
        'Idempotency-Key': approvalIdempKey,
      },
      body: JSON.stringify({ notes: 'Phase 4 Slice 4 initial approval' }),
    });

    const approveData = await resApprove.json();
    assert.strictEqual(resApprove.status, 200, `Approval failed: ${JSON.stringify(approveData)}`);
    originalSlipNumber = approveData.receipt?.slipNumber;
    console.log(`Approved original receipt: ${origReceiptId}`);
    console.log(`Original Slip Number: ${originalSlipNumber}`);
    assert(originalSlipNumber, 'Must generate original slip number');
    assert(!['PV-SLIP-2026-9264', 'PV-SLIP-2026-1888', 'PV-SLIP-2026-5611'].includes(originalSlipNumber));

    // Verify payment is paid once
    const paymentAfterApprove = await scopedDb(async (tx) => {
      return tx.paymentRecord.findUnique({ where: { id: targetPayment.id } });
    });
    assert.strictEqual(paymentAfterApprove.status, 'paid');
    assert.strictEqual(Number(paymentAfterApprove.paidAmount), installmentAmount);

    // 3. Step 2: Replace it
    console.log('\n--- Step 2: Replace Receipt ---');
    const plotBeforeReplace = await scopedDb(async (tx) => {
      return tx.plot.findUnique({ where: { id: targetPayment.booking.plot.id } });
    });
    const historyCountBeforeReplace = await scopedDb(async (tx) => {
      return tx.plotStatusHistory.count({ where: { plotId: targetPayment.booking.plot.id } });
    });

    const replaceIdempKey1 = `replace-key-1-${Date.now()}`;
    const replacePayload = {
      reasonCode: 'administrative_error',
      reason: 'Batch sequence alignment during internal audit review',
      correctionNotes: 'Confidential audit note: verified teller timestamp adjusted for sequence.',
    };

    const resReplace = await fetch(`${BASE_URL}/receipts/${origReceiptId}/replace`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
        'Idempotency-Key': replaceIdempKey1,
      },
      body: JSON.stringify(replacePayload),
    });

    const replaceData = await resReplace.json();
    assert.strictEqual(resReplace.status, 200, `Replacement failed: ${JSON.stringify(replaceData)}`);
    newSlipNumber = replaceData.receipt?.slipNumber;
    const newReceiptId = replaceData.receipt?.id;
    console.log(`Replacement succeeded!`);
    console.log(`New Slip Number: ${newSlipNumber}`);
    console.log(`New Receipt ID: ${newReceiptId}`);
    console.log(`Original status: ${replaceData.originalReceipt?.status}`);
    console.log(`New receipt status: ${replaceData.receipt?.status}`);

    assert(newSlipNumber, 'Must generate new slip number');
    assert.notStrictEqual(newSlipNumber, originalSlipNumber, 'New slip number must differ from original');
    assert.strictEqual(replaceData.receipt.status, 'verified', 'New receipt must be verified');
    assert.strictEqual(replaceData.originalReceipt.status, 'replaced', 'Original receipt must be replaced');
    assert.strictEqual(replaceData.receipt.replacesReceiptId, origReceiptId, 'replacesReceiptId must point to original');

    // Test Idempotency Replay with same key
    console.log('\n--- Testing Idempotency Replay (Same Key) ---');
    const resReplay = await fetch(`${BASE_URL}/receipts/${origReceiptId}/replace`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
        'Idempotency-Key': replaceIdempKey1,
      },
      body: JSON.stringify(replacePayload),
    });
    const replayData = await resReplay.json();
    assert.strictEqual(resReplay.status, 200, 'Replay must return 200');
    assert.strictEqual(replayData.receipt.id, newReceiptId, 'Replay must return same new receipt');
    assert.strictEqual(replayData.receipt.slipNumber, newSlipNumber, 'Replay must return same slip number');

    // Test second replace with a new key -> Must return 409
    console.log('\n--- Testing Second Replace with New Key (Expect 409) ---');
    const replaceIdempKey2 = `replace-key-2-${Date.now()}`;
    const resSecondReplace = await fetch(`${BASE_URL}/receipts/${origReceiptId}/replace`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
        'Idempotency-Key': replaceIdempKey2,
      },
      body: JSON.stringify(replacePayload),
    });
    assert.strictEqual(resSecondReplace.status, 409, `Second replace must return 409 Conflict, got ${resSecondReplace.status}`);
    console.log('Second replace correctly rejected with HTTP 409.');

    // 4. Step 3: Prove original public JSON is replaced, new public JSON is verified,
    // payment paidAmount is still the installment amount once, and plot was not changed by replacement.
    console.log('\n--- Step 3: Verify Public JSON, Payment, and Plot Integrity ---');
    const resOrigPublic = await fetch(`${BASE_URL}/receipts/verify/${originalSlipNumber}`);
    const origPublicData = await resOrigPublic.json();
    console.log('Original Receipt Public JSON:', JSON.stringify(origPublicData, null, 2));

    assert.strictEqual(origPublicData.exists, true);
    assert.strictEqual(origPublicData.status, 'replaced');
    assert.strictEqual(origPublicData.slipNumber, originalSlipNumber);
    assert.strictEqual(origPublicData.replacedBySlipNumber, newSlipNumber);
    assert(origPublicData.currentVerificationUrl && origPublicData.currentVerificationUrl.includes(newSlipNumber));
    // Verify only the specified fields are returned
    const origPublicKeys = Object.keys(origPublicData).sort();
    const expectedKeys = ['currentVerificationUrl', 'exists', 'replacedBySlipNumber', 'slipNumber', 'status'].sort();
    assert.deepStrictEqual(origPublicKeys, expectedKeys, `Original replaced JSON must contain ONLY the required keys. Found: ${origPublicKeys.join(', ')}`);
    assert.strictEqual(origPublicData.correctionNotes, undefined, 'correctionNotes must not appear in public JSON');

    const resNewPublic = await fetch(`${BASE_URL}/receipts/verify/${newSlipNumber}`);
    const newPublicData = await resNewPublic.json();
    console.log('\nNew Receipt Public JSON:', JSON.stringify(newPublicData, null, 2));
    assert.strictEqual(newPublicData.exists, true);
    assert.strictEqual(newPublicData.status, 'verified');
    assert.strictEqual(newPublicData.slipNumber, newSlipNumber);
    assert.strictEqual(newPublicData.hashKeyVersion, 1);
    assert(newPublicData.securityHashDisplay && newPublicData.securityHashDisplay.length === 16);

    // Verify payment paidAmount is still the installment amount once
    const paymentAfterReplace = await scopedDb(async (tx) => {
      return tx.paymentRecord.findUnique({ where: { id: targetPayment.id } });
    });
    console.log(`Payment status after replacement: ${paymentAfterReplace.status}, paidAmount: ${paymentAfterReplace.paidAmount}`);
    assert.strictEqual(paymentAfterReplace.status, 'paid');
    assert.strictEqual(Number(paymentAfterReplace.paidAmount), installmentAmount, 'paidAmount must not be doubled');

    // Verify plot was not changed by the replacement
    const plotAfterReplace = await scopedDb(async (tx) => {
      return tx.plot.findUnique({ where: { id: targetPayment.booking.plot.id } });
    });
    const historyCountAfterReplace = await scopedDb(async (tx) => {
      return tx.plotStatusHistory.count({ where: { plotId: targetPayment.booking.plot.id } });
    });
    assert.strictEqual(plotAfterReplace.status, plotBeforeReplace.status, 'Plot status must not change during replacement');
    assert.strictEqual(historyCountAfterReplace, historyCountBeforeReplace, 'No plot history must be written during replacement');

    // 5. Step 4: Cancel the new receipt through POST /receipts/:id/cancel
    console.log('\n--- Step 4: Cancel the Replacement Receipt ---');
    const cancelIdempKey = `cancel-replacement-${Date.now()}`;
    const cancelPayload = {
      reasonCode: 'duplicate_receipt',
      reason: 'Audit cycle complete; cancelling test replacement receipt',
    };

    const resCancel = await fetch(`${BASE_URL}/receipts/${newReceiptId}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
        'Idempotency-Key': cancelIdempKey,
      },
      body: JSON.stringify(cancelPayload),
    });

    const cancelData = await resCancel.json();
    assert.strictEqual(resCancel.status, 200, `Cancel replacement failed: ${JSON.stringify(cancelData)}`);
    console.log(`Replacement receipt ${newReceiptId} cancelled successfully.`);

    // 6. Step 5: Prove original stays replaced, new receipt is cancelled, installment 24 is pending with paidAmount 0, and plot is booked.
    console.log('\n--- Step 5: Prove Final State After Cancellation ---');
    const resOrigFinal = await fetch(`${BASE_URL}/receipts/verify/${originalSlipNumber}`);
    const origFinalData = await resOrigFinal.json();
    console.log('Original Final Public JSON:', JSON.stringify(origFinalData, null, 2));
    assert.strictEqual(origFinalData.status, 'replaced', 'Original receipt must stay replaced');
    assert.strictEqual(origFinalData.replacedBySlipNumber, newSlipNumber);

    const resNewFinal = await fetch(`${BASE_URL}/receipts/verify/${newSlipNumber}`);
    const newFinalData = await resNewFinal.json();
    console.log('New Receipt Final Public JSON (Cancelled):', JSON.stringify(newFinalData, null, 2));
    assert.strictEqual(newFinalData.status, 'cancelled', 'New receipt must be cancelled');

    const paymentFinal = await scopedDb(async (tx) => {
      return tx.paymentRecord.findUnique({ where: { id: targetPayment.id } });
    });
    console.log('Payment Final State:', {
      id: paymentFinal.id,
      installmentNumber: paymentFinal.installmentNumber,
      status: paymentFinal.status,
      paidAmount: Number(paymentFinal.paidAmount),
    });
    assert.strictEqual(paymentFinal.status, 'pending', 'Installment 24 must be pending');
    assert.strictEqual(Number(paymentFinal.paidAmount), 0, 'Installment 24 paidAmount must be 0');

    const plotFinal = await scopedDb(async (tx) => {
      return tx.plot.findUnique({ where: { id: targetPayment.booking.plot.id } });
    });
    console.log(`Plot Final Status: ${plotFinal.status}`);
    assert.strictEqual(plotFinal.status, 'booked', 'Plot must remain booked');

    // 7. Step 6: Prove PV-SLIP-2026-9264 is still verified
    console.log('\n--- Step 6: Prove PV-SLIP-2026-9264 Integrity ---');
    const res9264 = await fetch(`${BASE_URL}/receipts/verify/PV-SLIP-2026-9264`);
    const data9264 = await res9264.json();
    console.log('PV-SLIP-2026-9264 Public JSON:', JSON.stringify(data9264, null, 2));
    assert.strictEqual(data9264.exists, true);
    assert.strictEqual(data9264.status, 'verified');
    assert.strictEqual(data9264.slipNumber, 'PV-SLIP-2026-9264');
    assert.strictEqual(data9264.hashKeyVersion, null);

    console.log('\n====================================================');
    console.log('   ALL PHASE 4 SLICE 4 TESTS PASSED SUCCESSFULLY!   ');
    console.log('====================================================');

    // Print summary objects for output reporting
    console.log('\n--- SUMMARY FOR REPORT ---');
    console.log('REPLACED_ORIGINAL_JSON=' + JSON.stringify(origFinalData));
    console.log('CANCELLED_REPLACEMENT_JSON=' + JSON.stringify(newFinalData));
    console.log('PAYMENT_ROW=' + JSON.stringify({
      id: paymentFinal.id,
      installmentNumber: paymentFinal.installmentNumber,
      status: paymentFinal.status,
      paidAmount: Number(paymentFinal.paidAmount),
      amount: Number(paymentFinal.amount),
    }));
    console.log('PLOT_STATUS=' + plotFinal.status);
    console.log('JSON_9264=' + JSON.stringify(data9264));

  } catch (err) {
    console.error('\n*** TEST FAILED ***');
    console.error(err);
    if (originalSlipNumber) {
      console.error(`Original Slip Number: ${originalSlipNumber}`);
    }
    if (newSlipNumber) {
      console.error(`New Slip Number: ${newSlipNumber}`);
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

run();
