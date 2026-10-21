import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
  },
});

async function run() {
  const royalPlots = await prisma.plot.findMany({
    where: {
      blockId: 'royal',
      plotNumber: { in: ['1', '2', '3', '5', '6', '7', '8', 'R-01', 'R-02', 'R-03', 'B-05', 'R-06', 'R-07', 'R-08'] },
    },
    select: { plotNumber: true, status: true, id: true },
  });
  console.log('Royal matches in DB:', royalPlots);

  const overseasPlots = await prisma.plot.findMany({
    where: {
      blockId: 'overseas',
      plotNumber: { in: ['1', '2', '3', '4', '8', '9', 'OV-01', 'OV-02', 'OV-03', 'OV-04', 'C-08', 'C-09'] },
    },
    select: { plotNumber: true, status: true, id: true },
  });
  console.log('Overseas matches in DB:', overseasPlots);
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
