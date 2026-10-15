const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function connectWithRetry() {
  for (let i = 0; i < 5; i++) {
    try {
      await prisma.$connect();
      return;
    } catch (e) {
      console.log(`Connection attempt ${i + 1} failed, retrying in 2s...`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

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
  console.log('--- STARTING PHASE 3 SLICE 4 PROOFS ---\n');

  // Find the receipt and its associated payment row
  const receipt = await asSuperAdmin(async (tx) => {
    return tx.receiptSubmission.findFirst({
      where: { slipNumber: 'PV-SLIP-2026-1888' },
    });
  });

  const paymentRecordBefore = await asSuperAdmin(async (tx) => {
    return tx.paymentRecord.findUnique({
      where: { id: receipt.paymentRecordId },
    });
  });

  // If its amount is 500000, restore the original installment amount (116666)
  if (paymentRecordBefore && Number(paymentRecordBefore.amount) === 500000) {
    await asSuperAdmin(async (tx) => {
      await tx.paymentRecord.update({
        where: { id: receipt.paymentRecordId },
        data: { amount: 116666, paidAmount: 116666 },
      });
    });
  }

  // Also check receipt.amount
  if (Number(receipt.amount) === 500000) {
    await asSuperAdmin(async (tx) => {
      await tx.receiptSubmission.update({
        where: { id: receipt.id },
        data: { amount: 116666 },
      });
    });
  }

  const paymentRecordAfter = await asSuperAdmin(async (tx) => {
    return tx.paymentRecord.findUnique({
      where: { id: receipt.paymentRecordId },
    });
  });

  // PROOF 1: The payment row for PV-SLIP-2026-1888 is back to its original amount
  console.log('PROOF 1 (Payment row for PV-SLIP-2026-1888 before and after):');
  console.log('Payment Row Before:', JSON.stringify(paymentRecordBefore, null, 2));
  console.log('Payment Row After:', JSON.stringify(paymentRecordAfter, null, 2));
  console.log('Payment row amount equals original installment (116666):', String(paymentRecordAfter.amount) === '116666');
  console.log('\n----------------------------------------\n');

  // PROOF 2: Change the live block name, then read the public JSON for PV-SLIP-2026-1888.
  // It stays verified and has no block name. Restore the block name in the same test.
  const booking = await asSuperAdmin(async (tx) => {
    return tx.booking.findUnique({
      where: { id: receipt.bookingId },
      include: { plot: { include: { block: true } } },
    });
  });

  const targetBlock = booking.plot.block;
  const originalBlockName = targetBlock.name;

  let res2;
  try {
    // Change the live block name
    await asSuperAdmin(async (tx) => {
      await tx.block.update({
        where: { id: targetBlock.id },
        data: { name: 'Temporary Altered Block Name' },
      });
    });

    res2 = await fetch('http://localhost:3001/receipts/verify/PV-SLIP-2026-1888').then((r) => r.json());
    console.log('PROOF 2 (Public JSON with live block name altered):');
    console.log(JSON.stringify(res2, null, 2));
    console.log('Stays verified:', res2.status === 'verified');
    console.log('Has no blockName:', res2.blockName === undefined);
    console.log('Has no plot size:', res2.plotSize === undefined);
    console.log('Has no installment label:', res2.installmentLabel === undefined);
    console.log('Has no customerName:', res2.customerName === undefined);
  } finally {
    // Restore block name in the same test
    await asSuperAdmin(async (tx) => {
      await tx.block.update({
        where: { id: targetBlock.id },
        data: { name: originalBlockName },
      });
    });
    console.log('Restored live block name back to:', originalBlockName);
  }
  console.log('\n----------------------------------------\n');

  // PROOF 3: PV-SLIP-2026-9264 still returns its current full verified JSON, including block and installment label
  const res3 = await fetch('http://localhost:3001/receipts/verify/PV-SLIP-2026-9264').then((r) => r.json());
  console.log('PROOF 3 (PV-SLIP-2026-9264 legacy receipt full verified JSON):');
  console.log(JSON.stringify(res3, null, 2));
  console.log('Status is verified:', res3.status === 'verified');
  console.log('Includes blockName:', res3.blockName !== undefined, `(${res3.blockName})`);
  console.log('Includes installmentLabel:', res3.installmentLabel !== undefined, `(${res3.installmentLabel})`);
  console.log('hashKeyVersion is null:', res3.hashKeyVersion === null);

  console.log('\n--- ALL 3 PROOFS COMPLETED ---');
}

run().catch(console.error).finally(() => prisma.$disconnect());
