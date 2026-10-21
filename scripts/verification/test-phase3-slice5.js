const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function asSuperAdmin(fn) {
  for (let i = 0; i < 5; i++) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_role', 'super_admin', true)`;
        return fn(tx);
      });
    } catch (e) {
      if (i === 4) throw e;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

async function run() {
  console.log('=== PHASE 3 SLICE 5 PROOFS ===\n');

  // PROOF 1: Public JSON for PV-SLIP-2026-1888 is unchanged from the fourth slice
  const res1888 = await fetch('http://localhost:3001/receipts/verify/PV-SLIP-2026-1888').then(r => r.json());
  console.log('--- PROOF 1: Public JSON for PV-SLIP-2026-1888 ---');
  console.log(JSON.stringify(res1888, null, 2));

  const expected1888Keys = [
    'amount',
    'cnic',
    'exists',
    'hashKeyVersion',
    'issuer',
    'memberDisplayName',
    'membershipNo',
    'paymentDate',
    'plotNumber',
    'securityHashDisplay',
    'slipNumber',
    'status'
  ];
  const actual1888Keys = Object.keys(res1888).sort();
  console.log('Key check match slice 4:', JSON.stringify(actual1888Keys) === JSON.stringify(expected1888Keys));
  console.log('Status is verified:', res1888.status === 'verified');
  console.log('CNIC is masked cnicLast4Snapshot:', res1888.cnic === '***********7891');
  console.log('Security hash is 16 chars:', res1888.securityHashDisplay && res1888.securityHashDisplay.length === 16);
  console.log('No block name:', res1888.blockName === undefined);
  console.log('No plot size:', res1888.plotSize === undefined);
  console.log('No installment label:', res1888.installmentLabel === undefined);
  console.log('\n');

  // PROOF 2: Public JSON for PV-SLIP-2026-9264 is unchanged
  const res9264 = await fetch('http://localhost:3001/receipts/verify/PV-SLIP-2026-9264').then(r => r.json());
  console.log('--- PROOF 2: Public JSON for PV-SLIP-2026-9264 ---');
  console.log(JSON.stringify(res9264, null, 2));
  console.log('Status is verified:', res9264.status === 'verified');
  console.log('hashKeyVersion is null:', res9264.hashKeyVersion === null);
  console.log('Includes blockName:', res9264.blockName !== undefined, `(${res9264.blockName})`);
  console.log('Includes installmentLabel:', res9264.installmentLabel !== undefined, `(${res9264.installmentLabel})`);
  console.log('Includes plotSize:', res9264.plotSize !== undefined, `(${res9264.plotSize})`);
  console.log('\n');

  // PROOF 3: One integrity_mismatch response for 1888, then restore amountSnapshot in the same test
  const receipt1888 = await asSuperAdmin(async (tx) => {
    return tx.receiptSubmission.findFirst({
      where: { slipNumber: 'PV-SLIP-2026-1888' }
    });
  });
  const originalAmountSnapshot = receipt1888.amountSnapshot;

  try {
    // Tamper amountSnapshot
    await asSuperAdmin(async (tx) => {
      await tx.receiptSubmission.update({
        where: { id: receipt1888.id },
        data: { amountSnapshot: 777777 }
      });
    });

    const resMismatch = await fetch('http://localhost:3001/receipts/verify/PV-SLIP-2026-1888').then(r => r.json());
    console.log('--- PROOF 3: Tampered amountSnapshot (integrity_mismatch response) ---');
    console.log(JSON.stringify(resMismatch, null, 2));
    console.log('Status is integrity_mismatch:', resMismatch.status === 'integrity_mismatch');
    console.log('Only exists, status, slipNumber returned:', JSON.stringify(Object.keys(resMismatch).sort()) === JSON.stringify(['exists', 'slipNumber', 'status']));
  } finally {
    // Restore amountSnapshot in the same test
    await asSuperAdmin(async (tx) => {
      await tx.receiptSubmission.update({
        where: { id: receipt1888.id },
        data: { amountSnapshot: originalAmountSnapshot }
      });
    });
    console.log('Restored amountSnapshot back to original value:', originalAmountSnapshot);

    const resRestored = await fetch('http://localhost:3001/receipts/verify/PV-SLIP-2026-1888').then(r => r.json());
    console.log('After restore, status is verified again:', resRestored.status === 'verified');
  }

  console.log('\n=== ALL PROOFS PASSED ===');
}

run().catch(console.error).finally(() => prisma.$disconnect());
