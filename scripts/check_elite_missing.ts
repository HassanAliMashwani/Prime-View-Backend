import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { eliteBlockAreas } from '../../Prime View frontend/src/lib/map/eliteBlockAreas';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
  },
});

function normalize(p: string | null | undefined): string {
  if (!p) return '';
  const trimmed = p.trim();
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10).toString();
  }
  return trimmed;
}

async function run() {
  const mapPlotMap = new Map<string, any>();
  for (const a of eliteBlockAreas) {
    if (a.plotNumber) {
      const norm = normalize(a.plotNumber);
      if (!mapPlotMap.has(norm)) {
        mapPlotMap.set(norm, a);
      }
    }
  }


  const dbPlots = await prisma.plot.findMany({
    where: { blockId: 'elite' },
  });
  const dbSet = new Set(dbPlots.map(p => normalize(p.plotNumber)));

  const missing: any[] = [];
  for (const [norm, data] of mapPlotMap.entries()) {
    if (!dbSet.has(norm)) {
      missing.push(data);
    }
  }

  console.log(`Elite total map plots: ${mapPlotMap.size}`);
  console.log(`Elite existing in DB: ${dbPlots.length}`);
  console.log(`Elite missing in DB (${missing.length}):`, missing.map(m => m.plotNumber));
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
