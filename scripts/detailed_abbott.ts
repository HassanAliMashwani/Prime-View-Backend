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
  for (const a of abbottBlockAreas) {
    if (a.plotNumber) {
      const norm = normalize(a.plotNumber);
      if (!mapPlotMap.has(norm)) {
        mapPlotMap.set(norm, a);
      }
    }
  }

  const dbPlots = await prisma.plot.findMany({
    where: { blockId: 'abbott' },
    include: { bookings: true, reservations: true, currentOwner: true },
  });

  console.log(`Unique map plot numbers: ${mapPlotMap.size}`); // 467
  console.log(`DB plots: ${dbPlots.length}`); // 469

  const dbPlotMap = new Map<string, typeof dbPlots[0]>();
  for (const p of dbPlots) {
    dbPlotMap.set(p.plotNumber, p);
  }

  // Which map plots are not in DB?
  const missingMapInDb: string[] = [];
  for (const [norm, data] of mapPlotMap.entries()) {
    if (!dbPlotMap.has(norm) && !dbPlotMap.has(data.plotNumber)) {
      missingMapInDb.push(norm);
    }
  }
  console.log(`Missing map numbers in DB:`, missingMapInDb);

  // Which DB plots are not on map?
  const dbNotOnMap: any[] = [];
  for (const p of dbPlots) {
    const norm = normalize(p.plotNumber);
    if (!mapPlotMap.has(norm) && !mapPlotMap.has(p.plotNumber)) {
      dbNotOnMap.push({
        plotNumber: p.plotNumber,
        status: p.status,
        owner: p.currentOwner?.fullName,
        bookings: p.bookings.length,
        reservations: p.reservations.length,
      });
    }
  }
  console.log(`DB plots not on map (${dbNotOnMap.length}):`, dbNotOnMap);
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
