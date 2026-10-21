import 'dotenv/config';
import { PrismaClient, PlotCategory, PlotStatus } from '@prisma/client';
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
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10).toString();
  }
  return trimmed;
}

function derivePlotType(category: string, sizeLabel: string): string {
  const s = (sizeLabel || '').toLowerCase();
  if (category === 'commercial') {
    if (s.includes('30x50')) return 'commercial_30x50';
    return 'commercial_25x40';
  }
  if (category === 'amenity') {
    if (s.includes('mosq') || s.includes('masjid')) return 'amenity_mosque';
    if (s.includes('park')) return 'amenity_park';
    if (s.includes('hosp')) return 'amenity_hospital';
    if (s.includes('school')) return 'amenity_school';
    return 'amenity_community';
  }
  if (s.includes('2 kanal') || s.includes('2k')) return '2_kanal';
  if (s.includes('1 kanal') || s.includes('1k')) return '1_kanal';
  if (s.includes('13 marla') || s.includes('13m')) return '13_marla';
  if (s.includes('10 marla') || s.includes('10m')) return '10_marla';
  if (s.includes('7.5 marla') || s.includes('7.5m')) return '7.5_marla';
  if (s.includes('5 marla') || s.includes('5m')) return '5_marla';
  return '5_marla';
}

async function run() {
  console.log('=== STARTING INVENTORY MAP SYNCHRONIZATION ===\n');

  // 1. Process Chalet Block
  console.log('--- 1. CHALET BLOCK AUDIT & REMOVAL ---');
  const chaletPlots = await prisma.plot.findMany({
    where: { blockId: 'chalet' },
    include: {
      currentOwner: true,
      bookings: { include: { payments: true } },
      reservations: true,
    },
  });

  const allottedChaletPlots = chaletPlots.filter(p => p.status === 'allotted' || p.currentOwnerId || p.bookings.length > 0);
  for (const ap of allottedChaletPlots) {
    console.log(`[CHALET ALLOTTED PLOT] Plot Number: ${ap.plotNumber}, Owner: ${ap.currentOwner?.fullName || ap.currentOwnerId || 'Unknown'}, Status: ${ap.status}`);
  }

  if (allottedChaletPlots.length > 0) {
    console.log(`STOPPING Chalet Block deletion: ${allottedChaletPlots.length} plot(s) currently allotted/owned remain on the block.`);
  }

  // Delete unassigned Chalet plots that have no owner, no booking, no reservation, and no payment
  for (const cp of chaletPlots) {
    const hasOwner = Boolean(cp.currentOwnerId || cp.currentOwner);
    const hasBooking = cp.bookings.length > 0;
    const hasReservation = cp.reservations.length > 0;
    const hasPayment = cp.bookings.some(b => b.payments.length > 0);

    if (!hasOwner && !hasBooking && !hasReservation && !hasPayment) {
      await prisma.plot.delete({ where: { id: cp.id } });
      console.log(`Deleted unassigned Chalet plot: ${cp.plotNumber} (${cp.id})`);
    } else if (cp.plotNumber === 'CH-01' && cp.reservations.length > 0 && !hasOwner && !hasBooking && !hasPayment) {
      // CH-01 has 2 expired/cancelled test reservations. Check if safe to delete
      console.log(`Chalet plot ${cp.plotNumber} has ${cp.reservations.length} test reservation records (all expired/cancelled). Retaining for audit.`);
    }
  }

  // Remove chalet from police sub-admin assigned blocks
  const policeAssignments = await prisma.blockAssignment.deleteMany({
    where: {
      blockId: 'chalet',
      admin: { username: 'police' },
    },
  });
  console.log(`Removed ${policeAssignments.count} BlockAssignment record(s) for police sub-admin on 'chalet'.`);

  // 2. Map-driven Blocks
  const mapConfigs = [
    { blockId: 'abbott', name: 'Abbott', areas: abbottBlockAreas },
    { blockId: 'royal', name: 'Royal', areas: royalBlockAreas },
    { blockId: 'overseas', name: 'Overseas', areas: overseasBlockAreas },
    { blockId: 'elite', name: 'Elite', areas: eliteBlockAreas },
    { blockId: 'commercial', name: 'Commercial', areas: commercialBlockAreas },
    { blockId: 'npf-phase-1', name: 'NPF Phase 1', areas: npfPhase1BlockAreas },
  ];

  const results: any[] = [];

  for (const config of mapConfigs) {
    console.log(`\n--- PROCESSING BLOCK: ${config.name} (${config.blockId}) ---`);

    // Unique map plot numbers
    const mapPlotMap = new Map<string, any>();
    for (const a of config.areas) {
      if (!a.plotNumber) continue;
      const norm = normalizePlotNumber(a.plotNumber);
      if (!mapPlotMap.has(norm)) {
        mapPlotMap.set(norm, {
          norm,
          originalPlotNumber: a.plotNumber,
          category: a.category,
          sizeLabel: a.sizeLabel || 'Standard',
          amenityName: a.amenityName || (a as any).amenityType || null,
          slug: a.slug,
        });
      }
    }


    const uniqueMapCount = mapPlotMap.size;

    // Existing plots in DB before changes
    const existingDbPlots = await prisma.plot.findMany({
      where: { blockId: config.blockId },
      include: {
        currentOwner: true,
        bookings: { include: { payments: true } },
        reservations: true,
      },
    });

    const before = {
      available: existingDbPlots.filter(p => p.status === 'available').length,
      reserved: existingDbPlots.filter(p => p.status === 'reserved').length,
      booked: existingDbPlots.filter(p => p.status === 'booked').length,
      allotted: existingDbPlots.filter(p => p.status === 'allotted').length,
      total: existingDbPlots.length,
    };

    const dbMap = new Map<string, typeof existingDbPlots[0]>();
    for (const p of existingDbPlots) {
      const norm = normalizePlotNumber(p.plotNumber);
      dbMap.set(norm, p);
    }

    // A. Determine plots to delete
    const deletedPlots: string[] = [];
    const skippedPlots: { plotNumber: string; reason: string }[] = [];

    for (const p of existingDbPlots) {
      const norm = normalizePlotNumber(p.plotNumber);
      if (!mapPlotMap.has(norm)) {
        // Protected plot 155-2
        if (p.plotNumber === '155-2') {
          skippedPlots.push({ plotNumber: p.plotNumber, reason: 'Protected plot 155-2' });
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
          if (hasPayment) reasons.push(`payments`);
          skippedPlots.push({ plotNumber: p.plotNumber, reason: reasons.join(', ') });
        } else {
          await prisma.plot.delete({ where: { id: p.id } });
          deletedPlots.push(p.plotNumber);
        }
      }
    }

    // B. Determine plots to insert
    const insertedPlots: string[] = [];
    for (const [norm, mapData] of mapPlotMap.entries()) {
      if (!dbMap.has(norm)) {
        const cat = (mapData.category as PlotCategory) || PlotCategory.residential;
        const size = mapData.sizeLabel || 'Standard';
        const plotType = derivePlotType(cat, size);

        await prisma.plot.create({
          data: {
            blockId: config.blockId,
            plotNumber: mapData.originalPlotNumber,
            category: cat,
            size,
            amenityName: mapData.amenityName,
            plotType,
            price: 0,
            status: PlotStatus.available,
            isAdjustment: false,
            version: 0,
          },
        });
        insertedPlots.push(mapData.originalPlotNumber);
      }
    }

    // Update Block totalPlots in Block table
    await prisma.block.update({
      where: { id: config.blockId },
      data: { totalPlots: uniqueMapCount },
    });

    // DB plots after changes
    const afterDbPlots = await prisma.plot.findMany({
      where: { blockId: config.blockId },
    });

    const after = {
      available: afterDbPlots.filter(p => p.status === 'available').length,
      reserved: afterDbPlots.filter(p => p.status === 'reserved').length,
      booked: afterDbPlots.filter(p => p.status === 'booked').length,
      allotted: afterDbPlots.filter(p => p.status === 'allotted').length,
      total: afterDbPlots.length,
    };

    results.push({
      blockId: config.blockId,
      name: config.name,
      uniqueMapCount,
      before,
      after,
      insertedPlots,
      deletedPlots,
      skippedPlots,
    });
  }

  // Print Summary Report
  console.log('\n========================================================================================');
  console.log('                      INVENTORY OVERVIEW BEFORE & AFTER SUMMARY                         ');
  console.log('========================================================================================');
  for (const r of results) {
    console.log(`\nBlock: ${r.name} (${r.blockId}) | Unique Map Shapes: ${r.uniqueMapCount}`);
    console.log(`  BEFORE : Available=${r.before.available}, Reserved=${r.before.reserved}, Booked=${r.before.booked}, Allotted=${r.before.allotted}, Total=${r.before.total}`);
    console.log(`  AFTER  : Available=${r.after.available}, Reserved=${r.after.reserved}, Booked=${r.after.booked}, Allotted=${r.after.allotted}, Total=${r.after.total}`);
    console.log(`  INSERTED (${r.insertedPlots.length}): ${r.insertedPlots.join(', ') || 'None'}`);
    console.log(`  DELETED  (${r.deletedPlots.length}): ${r.deletedPlots.join(', ') || 'None'}`);
    console.log(`  SKIPPED/KEPT NON-MAP PLOTS (${r.skippedPlots.length}):`);
    for (const sp of r.skippedPlots) {
      console.log(`    - Plot ${sp.plotNumber}: ${sp.reason}`);
    }
  }
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
