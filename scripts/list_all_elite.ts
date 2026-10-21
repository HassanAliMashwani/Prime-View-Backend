/// <reference types="node" />
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } },
});

async function main() {
  const plots = await prisma.plot.findMany({
    where: { blockId: 'elite' },
    select: {
      id: true,
      plotNumber: true,
      category: true,
      size: true,
      price: true,
      status: true,
      amenityName: true,
      currentOwnerId: true,
    },
    orderBy: { plotNumber: 'asc' },
  });

  const numbers = plots.map((p) => p.plotNumber);
  console.log('Total elite plots count:', plots.length);
  console.log('All elite plot numbers:');
  console.log(numbers.join(', '));
}

main().finally(() => prisma.$disconnect());
