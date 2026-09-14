require('./env-helper').initEnv();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
  },
});

async function runScoped(session, callback) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT set_config('app.current_role', ${session.role || ''}, true),
             set_config('app.current_admin_id', ${session.adminId || ''}, true),
             set_config('app.current_customer_id', ${session.customerId || ''}, true),
             set_config('app.current_permissions', ${JSON.stringify(session.permissions || {})}, true);
    `;
    return callback(tx);
  });
}

async function main() {
  console.log('=== VERIFYING WAVE 0 RLS & PRIVILEGE ESCALATION GUARDS ===\n');

  // Test 1: Sub-Admin querying AdminUser directory
  console.log('1. Testing Sub-Admin SELECT scope on AdminUser:');
  const subAdminSession = {
    role: 'sub_admin',
    adminId: 'admin-2',
    permissions: { can_reserve: true, can_book: true },
  };

  // Sub-admin queries self -> MUST SUCCEED
  const self = await runScoped(subAdminSession, async (tx) => {
    return tx.adminUser.findUnique({ where: { id: 'admin-2' } });
  });
  console.log('   Sub-admin querying self (admin-2):', self ? `Found (${self.username})` : 'NOT FOUND (Error!)');
  if (!self || self.id !== 'admin-2') {
    throw new Error('RLS Failure: Sub-admin could not read own AdminUser row!');
  }

  // Sub-admin queries another admin (admin-1) -> MUST BE NULL
  const other = await runScoped(subAdminSession, async (tx) => {
    return tx.adminUser.findUnique({ where: { id: 'admin-1' } });
  });
  console.log('   Sub-admin querying super_admin (admin-1):', other ? `Leaked! (${other.username})` : 'PROTECTED (Null returned by RLS)');
  if (other) {
    throw new Error('SECURITY FAILURE: Sub-admin was able to read another admin user row!');
  }

  // Test 2: Sub-Admin privilege escalation attempt
  console.log('\n2. Testing Sub-Admin UPDATE privilege escalation guard:');
  let escalationBlocked = false;
  try {
    await runScoped(subAdminSession, async (tx) => {
      await tx.adminUser.update({
        where: { id: 'admin-2' },
        data: { role: 'super_admin' },
      });
    });
  } catch (err) {
    escalationBlocked = true;
    console.log('   Escalation attempt to change role to super_admin rejected with error:', err.message?.slice(0, 120) || err);
  }
  if (!escalationBlocked) {
    throw new Error('SECURITY FAILURE: Sub-admin was able to escalate role to super_admin!');
  }
  console.log('   --> Verified: Privilege escalation trigger successfully blocked role tampering!');

  // Test 3: Sub-Admin legitimate profile update
  console.log('\n3. Testing Sub-Admin legitimate profile update (fullName):');
  await runScoped(subAdminSession, async (tx) => {
    const updated = await tx.adminUser.update({
      where: { id: 'admin-2' },
      data: { fullName: 'Farhan Zaidi (Marketing Lead - Verified)' },
    });
    console.log('   Legitimate update succeeded for fullName:', updated.fullName);
  });

  // Revert fullName back to original via super_admin
  await runScoped({ role: 'super_admin' }, async (tx) => {
    await tx.adminUser.update({
      where: { id: 'admin-2' },
      data: { fullName: 'Farhan Zaidi (Marketing Lead)' },
    });
  });

  // Test 4: ReceiptSubmission RLS
  console.log('\n4. Testing ReceiptSubmission customer isolation:');
  const cust1Session = { role: 'customer', customerId: 'cust-1' };
  const cust2Session = { role: 'customer', customerId: 'cust-2' };
  
  const testId = `rcpt-test-${Date.now()}`;
  // Clean up any stale receipts
  await runScoped({ role: 'super_admin' }, async (tx) => {
    await tx.receiptSubmission.deleteMany({
      where: {
        id: { in: ['rcpt-test-rls-1'] }
      }
    });
  });

  // Insert a test receipt for cust-1
  const testReceipt = await runScoped(cust1Session, async (tx) => {
    return tx.receiptSubmission.create({
      data: {
        id: testId,
        customerId: 'cust-1',
        bookingId: 'book-1',
        depositoryBank: 'Meezan Bank',
        transactionRef: `TXN-${Date.now()}`,
        paymentDate: new Date('2026-09-13'),
        amount: 250000,
        receiptFileUrl: 'https://storage.primeview.pk/receipts/test.pdf',
        status: 'pending',
      }
    });
  });
  console.log('   Customer cust-1 inserted receipt:', testReceipt.id);

  // cust-1 queries receipt -> MUST BE VISIBLE
  const cust1View = await runScoped(cust1Session, async (tx) => {
    return tx.receiptSubmission.findUnique({ where: { id: testId } });
  });
  console.log('   cust-1 viewing own receipt:', cust1View ? 'Visible (Correct)' : 'Hidden (Error)');
  if (!cust1View) {
    throw new Error('RLS Failure: Customer could not see their own submitted receipt!');
  }

  // cust-2 queries cust-1 receipt -> MUST BE NULL
  const cust2View = await runScoped(cust2Session, async (tx) => {
    return tx.receiptSubmission.findUnique({ where: { id: testId } });
  });
  console.log('   cust-2 viewing cust-1 receipt:', cust2View ? 'Leaked! (Error)' : 'PROTECTED (Null returned by RLS)');
  if (cust2View) {
    throw new Error('SECURITY FAILURE: Customer 2 was able to view Customer 1 receipt!');
  }

  // Clean up test receipt
  await runScoped({ role: 'super_admin' }, async (tx) => {
    await tx.receiptSubmission.delete({ where: { id: testId } });
  });
  console.log('   Cleaned up test receipt.');

  console.log('\n=== ALL WAVE 0 RLS & PRIVILEGE ESCALATION CHECKS PASSED ===');
}

main().catch(console.error).finally(() => prisma.$disconnect());
