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
  const plots = await prisma.plot.findMany({
    where: { blockId: 'elite' },
    select: { plotNumber: true, category: true, amenityName: true, id: true }
  });
  const lowNums = plots.filter(p => Number(p.plotNumber) >= 0 && Number(p.plotNumber) <= 15);
  console.log('Low numbers in Elite in DB:', lowNums);

  console.log('\nChecking 169 vs "":');
  const clubPlots = plots.filter(p => p.amenityName?.includes('Club') || p.plotNumber === '169' || p.plotNumber === '' || p.plotNumber === '170');
  console.log('Club plots:', clubPlots);

  console.log('\nChecking 155 vs 155-2:');
  const p155 = plots.filter(p => p.plotNumber.startsWith('155'));
  console.log('155 plots:', p155);

  console.log('\nChecking CH-02:');
  const ch = plots.filter(p => p.plotNumber.startsWith('CH'));
  console.log('CH plots:', ch);
}

main().finally(() => prisma.$disconnect());
