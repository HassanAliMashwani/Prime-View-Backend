const path = require('path');
const envHelper = require(path.join(__dirname, 'scripts/verification/env-helper.js'));
envHelper.initEnv();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });

async function main() {
  await prisma.receiptSubmission.deleteMany({ where: { id: 'rcpt-1790119205284-i43g' } });
  const check1 = await prisma.$queryRaw`SELECT id, status FROM "ReceiptSubmission" WHERE id = 'rcpt-1790119205284-i43g'`;
  const check2 = await prisma.$queryRaw`SELECT id, status FROM "ReceiptSubmission" WHERE "customerId" = 'cust-1' AND status = 'pending'`;
  console.log('check1 (id match):', check1);
  console.log('check2 (cust-1 pending):', check2);
  
  const stats = await prisma.$queryRaw`SELECT "blockId", status, count(*)::int as count FROM "Plot" GROUP BY 1, 2 ORDER BY 1, 2`;
  console.log('Plot Stats:', stats);
}

main().catch(console.error).finally(() => prisma.$disconnect());
