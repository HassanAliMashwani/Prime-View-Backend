import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { royalBlockAreas } from '../../Prime View frontend/src/lib/map/royalBlockAreas';
import { overseasBlockAreas } from '../../Prime View frontend/src/lib/map/overseasBlockAreas';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
  },
});

async function run() {
  const royalMapNums = new Set(royalBlockAreas.map(a => a.plotNumber).filter(Boolean));
  console.log(`Royal unique map numbers count: ${royalMapNums.size}`); // 297
  const royalDbPlots = await prisma.plot.findMany({ where: { blockId: 'royal' } });
  console.log(`Royal DB plots count: ${royalDbPlots.length}`); // 306
  const royalDbNums = new Set(royalDbPlots.map(p => p.plotNumber));
  
  // In DB not map for Royal
  const royalInDbNotMap = royalDbPlots.filter(p => !royalMapNums.has(p.plotNumber));
  console.log(`Royal in DB not map (${royalInDbNotMap.length}):`, royalInDbNotMap.map(p => p.plotNumber));

  // In Map not DB for Royal
  const royalInMapNotDb = Array.from(royalMapNums).filter(n => !royalDbNums.has(n!));
  console.log(`Royal in map not DB (${royalInMapNotDb.length}):`, royalInMapNotDb);

  const overseasMapNums = new Set(overseasBlockAreas.map(a => a.plotNumber).filter(Boolean));
  console.log(`\nOverseas unique map numbers count: ${overseasMapNums.size}`); // 293
  const overseasDbPlots = await prisma.plot.findMany({ where: { blockId: 'overseas' } });
  console.log(`Overseas DB plots count: ${overseasDbPlots.length}`); // 301
  const overseasDbNums = new Set(overseasDbPlots.map(p => p.plotNumber));

  // In DB not map for Overseas
  const overseasInDbNotMap = overseasDbPlots.filter(p => !overseasMapNums.has(p.plotNumber));
  console.log(`Overseas in DB not map (${overseasInDbNotMap.length}):`, overseasInDbNotMap.map(p => p.plotNumber));

  // In Map not DB for Overseas
  const overseasInMapNotDb = Array.from(overseasMapNums).filter(n => !overseasDbNums.has(n!));
  console.log(`Overseas in map not DB (${overseasInMapNotDb.length}):`, overseasInMapNotDb);
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
