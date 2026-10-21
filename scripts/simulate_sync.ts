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
  // Treat 01 and 1 as the same plot
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10).toString();
  }
  return trimmed;
}

async function simulate() {
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
    
    // 1. Gather map plot numbers
    const mapPlotMap = new Map<string, any>();
    for (const a of config.areas) {
      if (!a.plotNumber) continue;
      const norm = normalizePlotNumber(a.plotNumber);
      if (!mapPlotMap.has(norm)) {
        mapPlotMap.set(norm, {
          plotNumber: norm,
          originalPlotNumber: a.plotNumber,
          category: a.category,
          sizeLabel: a.sizeLabel || 'Standard',
          amenityName: a.amenityName || (a as any).amenityType || null,
          slug: a.slug,
        });
      }
    }

    // Elite 170-232
    if (config.blockId === 'elite') {
      for (let i = 170; i <= 232; i++) {
        const norm = i.toString();
        if (!mapPlotMap.has(norm)) {
          mapPlotMap.set(norm, {
            plotNumber: norm,
            originalPlotNumber: norm,
            category: 'residential',
            sizeLabel: '5 Marla',
            amenityName: null,
            slug: `elite_chalet_${i}`,
          });
        }
      }
    }

    console.log(`Unique map plot numbers: ${mapPlotMap.size}`);

    // 2. Existing DB plots
    const dbPlots = await prisma.plot.findMany({
      where: { blockId: config.blockId },
      include: {
        currentOwner: true,
        bookings: {
          include: { payments: true },
        },
        reservations: true,
      },
    });

    const beforeStats = {
      available: dbPlots.filter(p => p.status === 'available').length,
      reserved: dbPlots.filter(p => p.status === 'reserved').length,
      booked: dbPlots.filter(p => p.status === 'booked').length,
      allotted: dbPlots.filter(p => p.status === 'allotted').length,
      total: dbPlots.length,
    };
    console.log(`Before: available=${beforeStats.available}, reserved=${beforeStats.reserved}, booked=${beforeStats.booked}, allotted=${beforeStats.allotted}, total=${beforeStats.total}`);

    // Map DB plots by normalized number
    const dbPlotMap = new Map<string, typeof dbPlots[0]>();
    for (const p of dbPlots) {
      const norm = normalizePlotNumber(p.plotNumber);
      dbPlotMap.set(norm, p);
    }

    // 3. Determine missing map plots to insert
    const toInsert: any[] = [];
    for (const [norm, mapData] of mapPlotMap.entries()) {
      if (!dbPlotMap.has(norm)) {
        toInsert.push(mapData);
      }
    }

    // 4. Determine DB plots not on map
    const toDelete: typeof dbPlots = [];
    const toKeepAndList: { plot: typeof dbPlots[0]; reason: string }[] = [];

    for (const p of dbPlots) {
      const norm = normalizePlotNumber(p.plotNumber);
      if (!mapPlotMap.has(norm)) {
        // Special case: Do not delete plot 155-2
        if (p.plotNumber === '155-2') {
          toKeepAndList.push({ plot: p, reason: 'Explicit protection (Do not delete plot 155-2)' });
          continue;
        }

        const hasOwner = Boolean(p.currentOwnerId || p.currentOwner);
        const hasBooking = p.bookings.length > 0;
        const hasReservation = p.reservations.length > 0;
        const hasPayment = p.bookings.some(b => b.payments.length > 0);

        if (hasOwner || hasBooking || hasReservation || hasPayment) {
          const reasons: string[] = [];
          if (hasOwner) reasons.push(`owner: ${p.currentOwner?.fullName || p.currentOwnerId}`);
          if (hasBooking) reasons.push(`bookings: ${p.bookings.length}`);
          if (hasReservation) reasons.push(`reservations: ${p.reservations.length}`);
          if (hasPayment) reasons.push(`payments: ${p.bookings.reduce((s, b) => s + b.payments.length, 0)}`);
          toKeepAndList.push({ plot: p, reason: reasons.join(', ') });
        } else {
          toDelete.push(p);
        }
      }
    }

    console.log(`To Insert (${toInsert.length}):`, toInsert.map(i => i.originalPlotNumber).slice(0, 20));
    console.log(`To Delete (${toDelete.length}):`, toDelete.map(d => d.plotNumber));
    console.log(`To Keep & List (${toKeepAndList.length}):`);
    for (const item of toKeepAndList) {
      console.log(`  * Plot ${item.plot.plotNumber} (status: ${item.plot.status}) -> ${item.reason}`);
    }

    const afterTotal = beforeStats.total + toInsert.length - toDelete.length;
    console.log(`Projected Total: ${afterTotal} (Unique map numbers: ${mapPlotMap.size})`);
  }
}

simulate()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
