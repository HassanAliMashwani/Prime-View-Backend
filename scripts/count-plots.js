const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  const count = await prisma.plot.count();
  console.log('Total plot count in DB:', count);
}
run().finally(() => prisma.$disconnect());
