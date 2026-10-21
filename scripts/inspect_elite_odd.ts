import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
  },
});

async function run() {
  const elitePlots = await prisma.plot.findMany({
    where: { blockId: 'elite' },
    select: { id: true, plotNumber: true, category: true, amenityName: true, status: true, currentOwnerId: true },
    orderBy: { plotNumber: 'asc' },
  });

  console.log('Elite plots count:', elitePlots.length);
  const oddPlots = elitePlots.filter(p => isNaN(Number(p.plotNumber)) || Number(p.plotNumber) <= 0 || Number(p.plotNumber) >= 233);
  console.log('Odd elite plots:', oddPlots);
}

run().catch(console.error).finally(() => prisma.$disconnect());
