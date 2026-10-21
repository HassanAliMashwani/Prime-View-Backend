/// <reference types="node" />
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } },
});

async function main() {
  const p = await prisma.plot.findMany({
    where: {
      blockId: 'elite',
      OR: [
        { plotNumber: { in: ['169', '170', '171', '172', '173', '174', '175', '176', '177', '178', '179', '180', '181', '182', '183', '184', '185', '186', '187'] } },
        { amenityName: { contains: 'Club' } },
        { plotNumber: '' },
      ],
    },
    select: {
      id: true,
      plotNumber: true,
      category: true,
      plotType: true,
      size: true,
      price: true,
      status: true,
      amenityName: true,
      currentOwnerId: true,
    },
    orderBy: { plotNumber: 'asc' },
  });
  console.log(JSON.stringify(p, null, 2));
}

main().finally(() => prisma.$disconnect());
