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
  const abbottPlots = await prisma.plot.findMany({
    where: { blockId: 'abbott' },
    select: { plotNumber: true, status: true },
  });
  console.log(`Total abbott plots in DB: ${abbottPlots.length}`);
  const withLetters = abbottPlots.filter(p => /[a-z]/i.test(p.plotNumber));
  console.log('Plots with letters in Abbott:', withLetters);
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
