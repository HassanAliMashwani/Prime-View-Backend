const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  const audit = await prisma.auditEntry.findMany({
    where: {
      OR: [
        { entityId: 'admin-1792420043074-9drm' },
        { action: { contains: 'umer' } },
        { details: { contains: 'umer' } }
      ]
    },
    take: 10,
    orderBy: { timestamp: 'desc' }
  });
  console.log(JSON.stringify(audit, null, 2));
}
run().finally(() => prisma.$disconnect());
