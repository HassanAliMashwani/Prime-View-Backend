const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  const hassan = await prisma.adminUser.findUnique({ where: { username: 'hassan' } });
  if (hassan) {
    await prisma.adminUser.update({
      where: { username: 'umer' },
      data: { passwordHash: hassan.passwordHash }
    });
    console.log('Updated umer password to match hassan (admin123)');
  }
}
run().finally(() => prisma.$disconnect());
