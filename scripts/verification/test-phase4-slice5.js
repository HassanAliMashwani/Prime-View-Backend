const assert = require('assert');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { initEnv } = require('./env-helper');

const env = initEnv();
const PORT = env.PORT || 3001;
const BASE_URL = `http://localhost:${PORT}`;

// Pre-test origin check
const rawOrigin = process.env.PUBLIC_RECEIPT_VERIFY_ORIGIN?.trim()?.replace(/\/$/, '');
if (!rawOrigin) {
  console.error('STOP: PUBLIC_RECEIPT_VERIFY_ORIGIN is missing.');
  process.exit(1);
}
if (
  rawOrigin.includes('localhost') ||
  rawOrigin.includes('127.0.0.1') ||
  rawOrigin.includes('192.168')
) {
  console.error(`STOP: PUBLIC_RECEIPT_VERIFY_ORIGIN contains forbidden address: ${rawOrigin}`);
  process.exit(1);
}

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required.');
}

const FORBIDDEN_SLIPS = [
  'PV-SLIP-2026-9264',
  'PV-SLIP-2026-1888',
  'PV-SLIP-2026-5611',
  'PV-SLIP-2026-5826',
  'PV-SLIP-2026-8572',
  'PV-SLIP-2026-6557',
  'PV-SLIP-2026-7615',
  'PV-SLIP-2026-8013',
];

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
  console.log('   PHASE 4 SLICE 5: REPLACEMENT RACE TEST');
  console.log('====================================================\n');

  let origReceiptId = null;
  let originalSlipNumber = null;
  let successSlipNumber = null;
  let successReceiptId = null;
  let secondSuccessSlip = null;
  let secondSuccessId = null;

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

    // Step 0: Inspect Installment 24
    console.log('--- Step 0: Inspect Installment 24 ---');
    const targetPayment = await scopedDb(async (tx) => {
      return tx.paymentRecord.findUnique({
        where: { id: 'pay-inst-book-1791638890685-ek4j-24' },
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
    console.log(`Plot Status: ${targetPayment.booking.plot.status}`);

    if (targetPayment.status !== 'pending' || Number(targetPayment.paidAmount) !== 0) {
      console.error(`STOP: Installment 24 status is '${targetPayment.status}' and paidAmount is ${targetPayment.paidAmount}. Must be pending and 0.`);
      process.exit(1);
    }

    const installmentAmount = Number(targetPayment.amount);
    const bookingId = targetPayment.bookingId;
    const customerId = targetPayment.booking.customerId;

    // Step 1: Approve one new receipt
    console.log('\n--- Step 1: Approve One New Receipt ---');
    origReceiptId = `p4-s5-orig-${Date.now()}`;
    const origTrxRef = `TRX-P4-RACE-${Date.now()}`;
    const paymentDate = new Date('2026-10-16T12:00:00.000Z');

    await scopedDb(async (tx) => {
      return tx.receiptSubmission.create({
        data: {
          id: origReceiptId,
          customerId,
          bookingId,
          paymentRecordId: targetPayment.id,
          amount: targetPayment.amount,
          paymentDate,
          depositoryBank: 'Meezan Bank Ltd',
          transactionRef: origTrxRef,
          paymentKind: 'regular',
          status: 'pending',
          receiptFileUrl: 'https://primeview.storage/receipts/test-p4-race.jpg',
        },
      });
    });

    const approvalIdempKey = `approve-race-${Date.now()}`;
    const resApprove = await fetch(`${BASE_URL}/receipts/${origReceiptId}/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
        'Idempotency-Key': approvalIdempKey,
      },
      body: JSON.stringify({ notes: 'Phase 4 Slice 5 initial approval' }),
    });

    const approveData = await resApprove.json();
    assert.strictEqual(resApprove.status, 200, `Approval failed: ${JSON.stringify(approveData)}`);
    originalSlipNumber = approveData.receipt?.slipNumber;
    console.log(`Approved original receipt: ${originalSlipNumber}`);
    assert(originalSlipNumber, 'Must generate original slip number');
    assert(!FORBIDDEN_SLIPS.includes(originalSlipNumber), `Generated forbidden slip number: ${originalSlipNumber}`);

    // Confirm payment paidAmount equals installment amount once
    const paymentAfterApprove = await scopedDb(async (tx) => {
      return tx.paymentRecord.findUnique({ where: { id: targetPayment.id } });
    });
    assert.strictEqual(paymentAfterApprove.status, 'paid');
    assert.strictEqual(Number(paymentAfterApprove.paidAmount), installmentAmount);

    // Step 2: Send two replace requests at the same time with two different Idempotency-Key values
    console.log('\n--- Step 2: Send Two Concurrent Replace Requests ---');
    const idempKey1 = `race-replace-1-${Date.now()}`;
    const idempKey2 = `race-replace-2-${Date.now()}`;

    const replacePayload1 = {
      reasonCode: 'administrative_error',
      reason: 'Concurrent replace test request 1',
    };
    const replacePayload2 = {
      reasonCode: 'administrative_error',
      reason: 'Concurrent replace test request 2',
    };

    const [res1, res2] = await Promise.all([
      fetch(`${BASE_URL}/receipts/${origReceiptId}/replace`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
          'Idempotency-Key': idempKey1,
        },
        body: JSON.stringify(replacePayload1),
      }),
      fetch(`${BASE_URL}/receipts/${origReceiptId}/replace`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
          'Idempotency-Key': idempKey2,
        },
        body: JSON.stringify(replacePayload2),
      }),
    ]);

    const data1 = await res1.json();
    const data2 = await res2.json();

    console.log(`Request 1 Result: Status HTTP ${res1.status}, Error: ${data1.error || 'none'}`);
    console.log(`Request 2 Result: Status HTTP ${res2.status}, Error: ${data2.error || 'none'}`);

    // Handle case if both succeeded
    if (res1.status === 200 && res2.status === 200) {
      const slip1 = data1.receipt?.slipNumber;
      const id1 = data1.receipt?.id;
      const slip2 = data2.receipt?.slipNumber;
      const id2 = data2.receipt?.id;
      console.error(`BOTH REPLACE REQUESTS SUCCEEDED! Slip 1: ${slip1}, Slip 2: ${slip2}`);

      // Cancel both through the cancel endpoint as instructed
      if (id1) {
        await fetch(`${BASE_URL}/receipts/${id1}/cancel`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminToken}`,
            'Idempotency-Key': `cancel-slip1-${Date.now()}`,
          },
          body: JSON.stringify({ reasonCode: 'duplicate_receipt', reason: 'Cleanup race failure 1' }),
        });
      }
      if (id2) {
        await fetch(`${BASE_URL}/receipts/${id2}/cancel`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminToken}`,
            'Idempotency-Key': `cancel-slip2-${Date.now()}`,
          },
          body: JSON.stringify({ reasonCode: 'duplicate_receipt', reason: 'Cleanup race failure 2' }),
        });
      }
      console.error('Both replacements cancelled. Stopping.');
      process.exit(1);
    }

    // Step 3: One request must succeed and the other must return HTTP 409
    console.log('\n--- Step 3: Assert One Succeeded and One Returned 409 ---');
    const successRes = res1.status === 200 ? { res: res1, data: data1, reqNum: 1 } : (res2.status === 200 ? { res: res2, data: data2, reqNum: 2 } : null);
    const conflictRes = res1.status === 409 ? { res: res1, data: data1, reqNum: 1 } : (res2.status === 409 ? { res: res2, data: data2, reqNum: 2 } : null);

    assert(successRes, `Expected one request to succeed with HTTP 200. Got: req1=${res1.status}, req2=${res2.status}`);
    assert(conflictRes, `Expected one request to fail with HTTP 409 Conflict. Got: req1=${res1.status}, req2=${res2.status}`);
    console.log(`Request ${successRes.reqNum} succeeded with HTTP 200.`);
    console.log(`Request ${conflictRes.reqNum} was rejected with HTTP 409 Conflict.`);

    successSlipNumber = successRes.data.receipt?.slipNumber;
    successReceiptId = successRes.data.receipt?.id;
    assert(successSlipNumber, 'Successful replacement must return a slipNumber');
    assert(!FORBIDDEN_SLIPS.includes(successSlipNumber), `Forbidden slip generated: ${successSlipNumber}`);
    console.log(`Successful replacement slip number: ${successSlipNumber}`);

    // Step 4: Exactly one new receipt may point at the original through replacesReceiptId
    console.log('\n--- Step 4: Verify Exactly One Replacement Points to Original ---');
    const replacementsInDb = await scopedDb(async (tx) => {
      return tx.receiptSubmission.findMany({
        where: { replacesReceiptId: origReceiptId },
        select: { id: true, slipNumber: true, status: true, replacesReceiptId: true },
      });
    });
    console.log(`Found ${replacementsInDb.length} replacement(s) pointing to original:`);
    for (const r of replacementsInDb) {
      console.log(`- ${r.slipNumber} (${r.id}): status=${r.status}`);
    }
    assert.strictEqual(replacementsInDb.length, 1, 'Exactly one replacement receipt must point to original');
    assert.strictEqual(replacementsInDb[0].id, successReceiptId, 'Replacement in DB must match successful response');

    // Step 5: The payment paidAmount must still equal the installment amount once
    console.log('\n--- Step 5: Verify Payment Record Paid Amount ---');
    const paymentAfterReplace = await scopedDb(async (tx) => {
      return tx.paymentRecord.findUnique({ where: { id: targetPayment.id } });
    });
    console.log(`Payment Status: ${paymentAfterReplace.status}, Paid Amount: ${paymentAfterReplace.paidAmount}`);
    assert.strictEqual(paymentAfterReplace.status, 'paid');
    assert.strictEqual(Number(paymentAfterReplace.paidAmount), installmentAmount, 'paidAmount must equal installment amount once');

    // Step 6: Cancel the successful replacement through POST /receipts/:id/cancel
    console.log('\n--- Step 6: Cancel Successful Replacement ---');
    const cancelIdempKey = `cancel-race-replacement-${Date.now()}`;
    const resCancel = await fetch(`${BASE_URL}/receipts/${successReceiptId}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
        'Idempotency-Key': cancelIdempKey,
      },
      body: JSON.stringify({
        reasonCode: 'duplicate_receipt',
        reason: 'Phase 4 Slice 5 race test cleanup cancellation',
      }),
    });
    const cancelData = await resCancel.json();
    assert.strictEqual(resCancel.status, 200, `Cancel replacement failed: ${JSON.stringify(cancelData)}`);
    console.log(`Replacement receipt ${successSlipNumber} cancelled successfully.`);

    // Step 7: Prove the original stays replaced, the replacement is cancelled,
    // installment 24 is pending with paidAmount 0, the plot is booked, and no receipt on that payment is verified.
    console.log('\n--- Step 7: Prove Final State ---');
    const resOrigFinal = await fetch(`${BASE_URL}/receipts/verify/${originalSlipNumber}`);
    const origFinalData = await resOrigFinal.json();
    console.log(`Original Slip (${originalSlipNumber}) Status: ${origFinalData.status}`);
    assert.strictEqual(origFinalData.status, 'replaced', 'Original receipt must stay replaced');
    assert.strictEqual(origFinalData.replacedBySlipNumber, successSlipNumber);

    const resSuccessFinal = await fetch(`${BASE_URL}/receipts/verify/${successSlipNumber}`);
    const successFinalData = await resSuccessFinal.json();
    console.log(`Replacement Slip (${successSlipNumber}) Status: ${successFinalData.status}`);
    assert.strictEqual(successFinalData.status, 'cancelled', 'Replacement receipt must be cancelled');

    const paymentFinal = await scopedDb(async (tx) => {
      return tx.paymentRecord.findUnique({ where: { id: targetPayment.id } });
    });
    console.log(`Payment Record: status=${paymentFinal.status}, paidAmount=${paymentFinal.paidAmount}, amount=${paymentFinal.amount}`);
    assert.strictEqual(paymentFinal.status, 'pending', 'Installment 24 must be pending');
    assert.strictEqual(Number(paymentFinal.paidAmount), 0, 'Installment 24 paidAmount must be 0');

    const plotFinal = await scopedDb(async (tx) => {
      return tx.plot.findUnique({ where: { id: targetPayment.booking.plot.id } });
    });
    console.log(`Plot Status: ${plotFinal.status}`);
    assert.strictEqual(plotFinal.status, 'booked', 'Plot must be booked');

    const allReceiptsOnPayment = await scopedDb(async (tx) => {
      return tx.receiptSubmission.findMany({
        where: { paymentRecordId: targetPayment.id },
        select: { slipNumber: true, status: true, replacesReceiptId: true },
      });
    });
    const verifiedOnPayment = allReceiptsOnPayment.filter(r => r.status === 'verified');
    console.log(`Total receipts on payment: ${allReceiptsOnPayment.length}, Verified count: ${verifiedOnPayment.length}`);
    assert.strictEqual(verifiedOnPayment.length, 0, 'There must be NO receipt in status verified on this payment');

    // Step 8: Prove PV-SLIP-2026-9264 is still verified
    console.log('\n--- Step 8: Prove PV-SLIP-2026-9264 Integrity ---');
    const res9264 = await fetch(`${BASE_URL}/receipts/verify/PV-SLIP-2026-9264`);
    const data9264 = await res9264.json();
    console.log(`PV-SLIP-2026-9264 Status: ${data9264.status}, hashKeyVersion: ${data9264.hashKeyVersion}`);
    assert.strictEqual(data9264.exists, true);
    assert.strictEqual(data9264.status, 'verified');
    assert.strictEqual(data9264.slipNumber, 'PV-SLIP-2026-9264');
    assert.strictEqual(data9264.hashKeyVersion, null);

    console.log('\n====================================================');
    console.log('   ALL PHASE 4 SLICE 5 CHECKS PASSED SUCCESSFULLY!  ');
    console.log('====================================================\n');

    // Final report outputs
    console.log('--- OUTPUT VALUES ---');
    console.log('REPLACE_RESULT_1=' + JSON.stringify({
      status: res1.status,
      body: res1.status === 200 ? { status: data1.receipt?.status, slipNumber: data1.receipt?.slipNumber } : { error: data1.error, message: data1.message },
    }));
    console.log('REPLACE_RESULT_2=' + JSON.stringify({
      status: res2.status,
      body: res2.status === 200 ? { status: data2.receipt?.status, slipNumber: data2.receipt?.slipNumber } : { error: data2.error, message: data2.message },
    }));
    console.log('FINAL_PAYMENT_ROW=' + JSON.stringify({
      id: paymentFinal.id,
      installmentNumber: paymentFinal.installmentNumber,
      status: paymentFinal.status,
      paidAmount: Number(paymentFinal.paidAmount),
      amount: Number(paymentFinal.amount),
    }));
    console.log('FINAL_PLOT_STATUS=' + plotFinal.status);
    console.log('STATUS_9264=' + data9264.status);

  } catch (err) {
    console.error('\n*** TEST FAILED ***');
    console.error(err);
    if (originalSlipNumber) {
      console.error(`Original Slip Number: ${originalSlipNumber}`);
    }
    if (successSlipNumber) {
      console.error(`Success Slip Number: ${successSlipNumber}`);
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

run();
