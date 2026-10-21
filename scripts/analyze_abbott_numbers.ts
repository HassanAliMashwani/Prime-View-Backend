import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { abbottBlockAreas } from '../../Prime View frontend/src/lib/map/abbottBlockAreas';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
  },
});

async function run() {
  const mapNums = new Set(abbottBlockAreas.map(a => a.plotNumber).filter(Boolean));
  console.log(`Unique map plot numbers count: ${mapNums.size}`); // 467

  const dbPlots = await prisma.plot.findMany({
    where: { blockId: 'abbott' },
    select: { plotNumber: true, status: true, id: true },
  });
  console.log(`DB plots count: ${dbPlots.length}`); // 469

  const dbNums = new Set(dbPlots.map(p => p.plotNumber));

  // Let's see: mapNums has 1, 2, 3, 4, 5, 6, 12, 14.
  // Does mapNums have all numbers from 1 to 467?
  const missingFrom1To467: number[] = [];
  for (let i = 1; i <= 467; i++) {
    if (!mapNums.has(i.toString())) {
      missingFrom1To467.push(i);
    }
  }
  console.log(`Missing from 1 to 467 in map:`, missingFrom1To467);

  // What is the max number in map?
  const mapInts = Array.from(mapNums).map(n => parseInt(n!, 10)).filter(n => !isNaN(n));
  console.log(`Min map int: ${Math.min(...mapInts)}, Max map int: ${Math.max(...mapInts)}`);

  // What numbers are in DB that are not in map?
  const inDbNotMap = dbPlots.filter(p => !mapNums.has(p.plotNumber));
  console.log(`In DB but not in map (${inDbNotMap.length}):`, inDbNotMap);

  // What numbers are in map that are not in DB?
  const inMapNotDb = Array.from(mapNums).filter(n => !dbNums.has(n!));
  console.log(`In map but not in DB (${inMapNotDb.length}):`, inMapNotDb);
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
