const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function asSuperAdmin(fn) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_role', 'super_admin', true)`;
    return fn(tx);
  });
}

async function run() {
  console.log('--- STARTING PROOFS ---\n');

  // Proof 1: Untouched PV-SLIP-2026-1888 stays verified, and the amount shown equals amountSnapshot
  const res1 = await fetch('http://localhost:3001/receipts/verify/PV-SLIP-2026-1888').then(r => r.json());
  console.log('PROOF 1 (Untouched PV-SLIP-2026-1888):');
  console.log(JSON.stringify(res1, null, 2));

  // Find original receipt
  const originalReceipt = await prisma.receiptSubmission.findFirst({
    where: { slipNumber: 'PV-SLIP-2026-1888' }
  });
  const originalAmount = originalReceipt.amount;
  const originalAmountSnapshot = originalReceipt.amountSnapshot;

  // Proof 2: Change the live payment amount only. The public result stays verified and still shows amountSnapshot.
  try {
    await asSuperAdmin(async (tx) => {
      await tx.receiptSubmission.update({
        where: { id: originalReceipt.id },
        data: { amount: 500000 }
      });
    });

    const res2 = await fetch('http://localhost:3001/receipts/verify/PV-SLIP-2026-1888').then(r => r.json());
    console.log('\nPROOF 2 (Live payment amount changed to 500000, amountSnapshot remains 116666):');
    console.log(JSON.stringify(res2, null, 2));
  } finally {
    await asSuperAdmin(async (tx) => {
      await tx.receiptSubmission.update({
        where: { id: originalReceipt.id },
        data: { amount: originalAmount }
      });
    });
  }

  // Proof 3: Change amountSnapshot. The public result is integrity_mismatch and the JSON has no amount. Restore amountSnapshot in the same test.
  try {
    await asSuperAdmin(async (tx) => {
      await tx.receiptSubmission.update({
        where: { id: originalReceipt.id },
        data: { amountSnapshot: 999999 }
      });
    });

    const res3 = await fetch('http://localhost:3001/receipts/verify/PV-SLIP-2026-1888').then(r => r.json());
    console.log('\nPROOF 3 (amountSnapshot tampered to 999999):');
    console.log(JSON.stringify(res3, null, 2));
  } finally {
    await asSuperAdmin(async (tx) => {
      await tx.receiptSubmission.update({
        where: { id: originalReceipt.id },
        data: { amountSnapshot: originalAmountSnapshot }
      });
    });
  }

  // Proof 4: PV-SLIP-2026-9264 stays verified
  const res4 = await fetch('http://localhost:3001/receipts/verify/PV-SLIP-2026-9264').then(r => r.json());
  console.log('\nPROOF 4 (PV-SLIP-2026-9264 legacy receipt with null hashKeyVersion):');
  console.log(JSON.stringify(res4, null, 2));
}

run().catch(console.error).finally(() => prisma.$disconnect());
