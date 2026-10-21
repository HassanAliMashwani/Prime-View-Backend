const assert = require('assert');
const { PrismaClient, Prisma } = require('@prisma/client');
const { initEnv } = require('./env-helper');

initEnv();

const prisma = new PrismaClient();
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
  console.log('   PHASE 3 SLICE 2: HMAC INTEGRITY VERIFICATION TEST');
  console.log('====================================================\n');

  const slipNumber = 'PV-SLIP-2026-1888';

  // 1. Untouched, the public result stays verified
  console.log(`Step 1: Checking untouched public verify for ${slipNumber}...`);
  const resUntouched = await fetch(`${BASE_URL}/receipts/verify/${slipNumber}`);
  assert.strictEqual(resUntouched.status, 200, `Untouched verify should return 200, got ${resUntouched.status}`);
  const dataUntouched = await resUntouched.json();

  console.log('\n[UNTOUCHED PUBLIC RESULT]');
  console.log(JSON.stringify(dataUntouched, null, 2));

  assert.strictEqual(dataUntouched.exists, true, 'Slip must exist');
  assert.strictEqual(dataUntouched.status, 'verified', 'Untouched slip must have status verified');
  assert.strictEqual(dataUntouched.hashKeyVersion, 1, 'Untouched slip must have hashKeyVersion 1');
  assert.strictEqual(dataUntouched.integrityHash, undefined, 'Must not leak integrityHash');
  assert.strictEqual(dataUntouched.secret, undefined, 'Must not leak secret');
  console.log('✓ Step 1 passed: Untouched slip returns status "verified"');

  // Read original DB row so we can restore exact amountSnapshot
  const origDbRow = await scopedDb((tx) =>
    tx.receiptSubmission.findUnique({ where: { slipNumber } })
  );
  assert(origDbRow, `Receipt with slipNumber ${slipNumber} must exist in DB`);
  const originalAmountSnapshot = origDbRow.amountSnapshot;
  console.log(`Original amountSnapshot in DB: ${originalAmountSnapshot}`);

  // 2. Change amountSnapshot in a transaction, re-read, and public result is integrity_mismatch
  console.log(`\nStep 2: Modifying amountSnapshot to 999999.00 in DB...`);
  await scopedDb((tx) =>
    tx.receiptSubmission.update({
      where: { slipNumber },
      data: { amountSnapshot: new Prisma.Decimal('999999.00') },
    })
  );

  console.log(`Re-reading public verify for ${slipNumber}...`);
  const resMismatch = await fetch(`${BASE_URL}/receipts/verify/${slipNumber}`);
  assert.strictEqual(resMismatch.status, 200, `Mismatch verify should return 200, got ${resMismatch.status}`);
  const dataMismatch = await resMismatch.json();

  console.log('\n[TAMPERED / INTEGRITY_MISMATCH PUBLIC RESULT]');
  console.log(JSON.stringify(dataMismatch, null, 2));

  assert.strictEqual(dataMismatch.exists, true, 'Slip must exist');
  assert.strictEqual(dataMismatch.status, 'integrity_mismatch', 'Tampered slip must have status integrity_mismatch');
  assert.strictEqual(dataMismatch.integrityHash, undefined, 'Must not leak integrityHash');
  assert.strictEqual(dataMismatch.secret, undefined, 'Must not leak secret');

  // Verify the DB row status was NOT changed to integrity_mismatch (pure read-only verification)
  const dbRowAfterMismatch = await scopedDb((tx) =>
    tx.receiptSubmission.findUnique({ where: { slipNumber } })
  );
  assert.strictEqual(dbRowAfterMismatch.status, 'verified', 'DB row status must NOT be altered by public verify');
  console.log('✓ Step 2 passed: Tampered slip returns status "integrity_mismatch" without updating DB row');

  // 3. Put amountSnapshot back in that same test so the receipt is verified again
  console.log(`\nStep 3: Restoring original amountSnapshot (${originalAmountSnapshot}) in DB...`);
  await scopedDb((tx) =>
    tx.receiptSubmission.update({
      where: { slipNumber },
      data: { amountSnapshot: originalAmountSnapshot },
    })
  );

  console.log(`Re-reading public verify for restored ${slipNumber}...`);
  const resRestored = await fetch(`${BASE_URL}/receipts/verify/${slipNumber}`);
  assert.strictEqual(resRestored.status, 200, `Restored verify should return 200, got ${resRestored.status}`);
  const dataRestored = await resRestored.json();

  console.log('\n[RESTORED PUBLIC RESULT]');
  console.log(JSON.stringify(dataRestored, null, 2));

  assert.strictEqual(dataRestored.status, 'verified', 'Restored slip must verify again');
  console.log('✓ Step 3 passed: Receipt verifies successfully again after restoring amountSnapshot');

  // 4. PV-SLIP-2026-9264 still verifies
  console.log(`\nStep 4: Checking old receipt PV-SLIP-2026-9264...`);
  const resOld = await fetch(`${BASE_URL}/receipts/verify/PV-SLIP-2026-9264`);
  assert.strictEqual(resOld.status, 200, `Old slip verify should return 200, got ${resOld.status}`);
  const dataOld = await resOld.json();

  console.log('\n[OLD RECEIPT PV-SLIP-2026-9264 PUBLIC RESULT]');
  console.log(JSON.stringify(dataOld, null, 2));

  assert.strictEqual(dataOld.exists, true, 'Old slip must exist');
  assert.strictEqual(dataOld.status, 'verified', 'Old slip must remain verified');
  assert.strictEqual(dataOld.slipNumber, 'PV-SLIP-2026-9264', 'Slip number must match');
  assert.strictEqual(dataOld.securityHash, 'PV-SEC-A08E-46B1-3239', 'Old securityHash must be preserved');
  assert.strictEqual(dataOld.hashKeyVersion, null, 'Old slip hashKeyVersion must be null');
  console.log('✓ Step 4 passed: PV-SLIP-2026-9264 still verifies as GENUINE & VERIFIED');

  console.log('\n====================================================');
  console.log('   ALL PHASE 3 SLICE 2 PROOFS PASSED SUCCESSFULLY!');
  console.log('====================================================');
}

run()
  .catch((e) => {
    console.error('Error during proof test:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
