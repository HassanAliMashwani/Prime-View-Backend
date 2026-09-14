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
  console.log('=== VERIFYING SUB-ADMIN TO SUB-ADMIN ISOLATION ===\n');

  // Let's see all admin users as super_admin
  const admins = await runScoped({ role: 'super_admin' }, async (tx) => {
    return tx.adminUser.findMany({ select: { id: true, username: true, role: true } });
  });
  console.log('All Admin Users in database:', admins);

  const subAdmins = admins.filter(a => a.role === 'sub_admin');
  const subAdminA = subAdmins.find(s => s.id === 'admin-2');
  const subAdminB = subAdmins.find(s => s.id !== 'admin-2');

  const subAdminA_id = subAdminA.id;
  const subAdminB_id = subAdminB.id;

  console.log(`Sub Admin A: ${subAdminA.username} (${subAdminA_id})`);
  console.log(`Sub Admin B: ${subAdminB.username} (${subAdminB_id})`);

  // Now test Sub-Admin A (admin-2) querying Sub-Admin B (admin-3)
  const subAdminASession = {
    role: 'sub_admin',
    adminId: subAdminA_id,
    permissions: { can_reserve: true, can_book: true },
  };

  console.log(`\nTesting Sub Admin A (${subAdminA_id}) querying Sub Admin B (${subAdminB_id}):`);
  const result = await runScoped(subAdminASession, async (tx) => {
    return tx.adminUser.findUnique({ where: { id: subAdminB_id } });
  });

  console.log('Query result:', result ? `LEAKED! (${result.username})` : 'PROTECTED (Null returned by RLS)');

  // Also test querying findMany
  const allSeenBySubAdminA = await runScoped(subAdminASession, async (tx) => {
    return tx.adminUser.findMany();
  });
  console.log(`Sub Admin A running findMany() sees ${allSeenBySubAdminA.length} rows:`, allSeenBySubAdminA.map(u => u.username));


  if (result !== null) {
    throw new Error('SECURITY VIOLATION: Sub Admin A was able to read Sub Admin B!');
  }
  if (allSeenBySubAdminA.length !== 1 || allSeenBySubAdminA[0].id !== 'admin-2') {
    throw new Error('SECURITY VIOLATION: Sub Admin A saw more than just their own row!');
  }

  console.log('\nCONFIRMED: AdminUser SELECT policy is strictly Super Admin + self-row only!');
}

main().catch(console.error).finally(() => prisma.$disconnect());
