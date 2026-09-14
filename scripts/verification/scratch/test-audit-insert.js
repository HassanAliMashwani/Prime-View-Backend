const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

async function main() {
  const session = {
    adminId: 'admin-2',
    username: 'marketing',
    fullName: 'Farhan Zaidi (Marketing Lead)',
    role: 'sub_admin',
    assignedBlocks: [ 'abbott', 'royal' ],
    permissions: { can_book: true, can_reserve: true },
  };

  try {
    const res = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT set_config('app.current_role', ${session.role}, true),
               set_config('app.current_admin_id', COALESCE(${session.adminId}, ''), true),
               set_config('app.current_customer_id', COALESCE(${session.customerId || ''}, ''), true),
               set_config('app.can_create_customer', ${String(!!session.permissions?.can_create_customer)}, true),
               set_config('app.can_book', ${String(!!session.permissions?.can_book)}, true),
               set_config('app.can_reserve', ${String(!!session.permissions?.can_reserve)}, true),
               set_config('app.current_permissions', ${JSON.stringify(session.permissions || {})}, true);
      `;
      
      const roleSetting = await tx.$queryRawUnsafe(`SELECT current_setting('app.current_role', true) as role;`);
      console.log('Current setting app.current_role in tx:', roleSetting);

      return tx.auditEntry.create({
        data: {
          actorId: session.adminId,
          actorName: session.fullName,
          actorRole: session.role,
          action: 'PLOT_LOCK_ACQUIRED',
          entityType: 'lock',
          entityId: 'plot-a-02',
          details: 'Testing audit insert under sub_admin',
        },
      });
    });
    console.log('Audit insert SUCCEEDED:', res.id);
  } catch (err) {
    console.error('Audit insert FAILED:', err);
  }
}

main().finally(() => prisma.$disconnect());
