import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkDatabase() {
  try {
    const blockCount = await prisma.block.count();
    const customerCount = await prisma.customer.count();
    const plotCount = await prisma.plot.count();
    const adminCount = await prisma.adminUser.count();
    const auditCount = await prisma.auditEntry.count();

    console.log(`\n--- Seeded Row Counts ---`);
    console.log(`Blocks: ${blockCount}`);
    console.log(`Customers: ${customerCount}`);
    console.log(`Plots: ${plotCount}`);
    console.log(`Admin Users: ${adminCount}`);
    console.log(`Audit Entries: ${auditCount}`);

    const rlsCheck = await prisma.$queryRaw`
      SELECT relname, relrowsecurity 
      FROM pg_class 
      WHERE relname IN ('Plot', 'Customer', 'AuditEntry');
    `;

    console.log(`\n--- RLS Status ---`);
    console.log(rlsCheck);
  } catch (error) {
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

checkDatabase();
