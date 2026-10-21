import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.adminUser.findMany({
    include: {
      assignments: {
        include: {
          block: true,
        },
      },
    },
  });

  for (const u of users) {
    console.log('-------------------------------------------');
    console.log(`Username: ${u.username}`);
    console.log(`Full Name: ${u.fullName}`);
    console.log(`Role: ${u.role}`);
    console.log(`Status: ${u.status}`);
    console.log(`Permissions:`, JSON.stringify(u.permissions));
    console.log(`Assignments:`, u.assignments.map((a) => a.block.name || a.block.id));
  }
}

main().finally(() => prisma.$disconnect());
