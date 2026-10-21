const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  const users = await prisma.adminUser.findMany({
    where: { username: { in: ['umer', 'hassan', 'admin'] } },
    select: { username: true, passwordHash: true }
  });
  console.log(users);
}
run().finally(() => prisma.$disconnect());
