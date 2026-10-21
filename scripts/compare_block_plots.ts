import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { abbottBlockAreas } from '../../Prime View frontend/src/lib/map/abbottBlockAreas';
import { royalBlockAreas } from '../../Prime View frontend/src/lib/map/royalBlockAreas';
import { overseasBlockAreas } from '../../Prime View frontend/src/lib/map/overseasBlockAreas';
import { eliteBlockAreas } from '../../Prime View frontend/src/lib/map/eliteBlockAreas';
import { commercialBlockAreas } from '../../Prime View frontend/src/lib/map/commercialBlockAreas';
import { npfPhase1BlockAreas } from '../../Prime View frontend/src/lib/map/npfPhase1BlockAreas';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
  },
});

function normalizePlotNumber(p: string | null | undefined): string {
  if (!p) return '';
  const trimmed = p.trim();
  // If pure number with leading zeroes: "01" -> "1"
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10).toString();
  }
  return trimmed;
}

async function run() {
  const mapConfigs = [
    { blockId: 'abbott', name: 'Abbott', areas: abbottBlockAreas },
    { blockId: 'royal', name: 'Royal', areas: royalBlockAreas },
    { blockId: 'overseas', name: 'Overseas', areas: overseasBlockAreas },
    { blockId: 'elite', name: 'Elite', areas: eliteBlockAreas },
    { blockId: 'commercial', name: 'Commercial', areas: commercialBlockAreas },
    { blockId: 'npf-phase-1', name: 'NPF Phase 1', areas: npfPhase1BlockAreas },
  ];

  for (const config of mapConfigs) {
    console.log(`\n=================== BLOCK: ${config.name} (${config.blockId}) ===================`);
    
    // Map plots
    const mapPlotMap = new Map<string, any>();
    const shapesWithNoPlotNumber: any[] = [];
    const groupedShapes: any[] = [];

    for (const a of config.areas) {
      if (a.isGroupedRange) {
        groupedShapes.push(a);
      }
      if (!a.plotNumber) {
        shapesWithNoPlotNumber.push(a.slug);
      } else {
        const norm = normalizePlotNumber(a.plotNumber);
        if (!mapPlotMap.has(norm)) {
          mapPlotMap.set(norm, {
            originalPlotNumber: a.plotNumber,
            category: a.category,
            sizeLabel: a.sizeLabel,
            amenityName: a.amenityName || (a as any).amenityType,
            slug: a.slug,
          });
        }
      }
    }

    // Elite special handling: 170-232
    if (config.blockId === 'elite') {
      console.log(`Elite grouped shapes:`, groupedShapes.map(g => ({ slug: g.slug, rangeSpan: g.rangeSpan })));
      for (let i = 170; i <= 232; i++) {
        const norm = i.toString();
        if (!mapPlotMap.has(norm)) {
          mapPlotMap.set(norm, {
            originalPlotNumber: norm,
            category: 'residential',
            sizeLabel: '5 Marla',
            amenityName: null,
            slug: `elite_chalet_${i}`,
          });
        }
      }
    }

    console.log(`Shapes with no plotNumber (${shapesWithNoPlotNumber.length}):`, shapesWithNoPlotNumber.slice(0, 5));
    console.log(`Unique map plot numbers: ${mapPlotMap.size}`);

    // DB plots
    const dbPlots = await prisma.plot.findMany({
      where: { blockId: config.blockId },
      include: {
        currentOwner: true,
        bookings: true,
        reservations: true,
      },
    });

    console.log(`DB plots count: ${dbPlots.length}`);
    const dbPlotMap = new Map<string, typeof dbPlots[0]>();
    for (const p of dbPlots) {
      const norm = normalizePlotNumber(p.plotNumber);
      dbPlotMap.set(norm, p);
    }

    // Compare
    const missingInDb: string[] = [];
    for (const [norm, mapData] of mapPlotMap.entries()) {
      if (!dbPlotMap.has(norm)) {
        missingInDb.push(norm);
      }
    }

    const missingInMap: typeof dbPlots = [];
    for (const [norm, dbPlot] of dbPlotMap.entries()) {
      if (!mapPlotMap.has(norm)) {
        missingInMap.push(dbPlot);
      }
    }

    console.log(`Missing in DB (Need to Insert): ${missingInDb.length}`, missingInDb.slice(0, 15));
    console.log(`In DB but NOT on Map: ${missingInMap.length}`);
    for (const p of missingInMap) {
      console.log(`  - DB Plot ${p.plotNumber} (id: ${p.id}, status: ${p.status}, owner: ${p.currentOwnerId}, bookings: ${p.bookings.length}, reservations: ${p.reservations.length})`);
    }
  }
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
