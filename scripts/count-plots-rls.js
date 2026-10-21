const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  // Query using DIRECT_URL with postgres superuser or withScopedSession as superadmin
  const directPrisma = new PrismaClient({
    datasources: { db: { url: process.env.DIRECT_URL } }
  });
  const countDirect = await directPrisma.plot.count();
  console.log('Plot count via DIRECT_URL (postgres role):', countDirect);
  await directPrisma.$disconnect();

  // Also query with admin-1 scoped session
  const scopedPlots = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_admin_id', 'admin-1', true), set_config('app.current_admin_role', 'super_admin', true)`;
    return await tx.plot.count();
  });
  console.log('Plot count via scoped session as super_admin:', scopedPlots);
}
run().finally(() => prisma.$disconnect());
