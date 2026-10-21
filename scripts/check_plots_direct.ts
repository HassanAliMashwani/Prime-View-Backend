import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
  },
});

async function main() {
  const totalPlots = await prisma.plot.count();
  console.log('Total plots with DIRECT_URL:', totalPlots);

  const blocks = await prisma.block.findMany({ select: { id: true, name: true, totalPlots: true } });
  console.log('Blocks:', blocks);

  const royalPlots = await prisma.plot.findMany({ where: { blockId: 'royal' }, select: { plotNumber: true, status: true } });
  console.log(`Royal plots count: ${royalPlots.length}`);
  if (royalPlots.length > 0) {
    console.log('Royal sample:', royalPlots.slice(0, 10));
  }

  const overseasPlots = await prisma.plot.findMany({ where: { blockId: 'overseas' }, select: { plotNumber: true, status: true } });
  console.log(`Overseas plots count: ${overseasPlots.length}`);
  if (overseasPlots.length > 0) {
    console.log('Overseas sample:', overseasPlots.slice(0, 10));
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
