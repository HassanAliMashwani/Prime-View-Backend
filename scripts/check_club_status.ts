/// <reference types="node" />
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } },
});

async function main() {
  const plot169 = await prisma.plot.findFirst({
    where: { blockId: 'elite', plotNumber: '169' },
  });
  console.log('Plot 169:', plot169);

  const emptyPlot = await prisma.plot.findFirst({
    where: { blockId: 'elite', plotNumber: '' },
  });
  console.log('Empty plotNumber row:', emptyPlot);
}

main().finally(() => prisma.$disconnect());
