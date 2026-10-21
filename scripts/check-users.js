const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  const users = await prisma.adminUser.findMany({
    select: {
      id: true,
      username: true,
      fullName: true,
      role: true,
      permissions: true,
      assignments: { select: { blockId: true } }
    }
  });
  console.log(JSON.stringify(users, null, 2));
}
run().finally(() => prisma.$disconnect());
