import 'dotenv/config';
import { PrismaClient, PlotStatus } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } },
});

async function main() {
  console.log('=== STARTING CLEANUP OF TEST DATA ===\n');

  // 1. Find all customers to delete
  const customers = await prisma.customer.findMany({
    select: { id: true, fullName: true, membershipNo: true },
  });
  console.log(`Found ${customers.length} customers to delete.`);

  // 2. Delete payment allocations
  const allocCount = await prisma.paymentAllocation.deleteMany({});
  console.log(`Deleted ${allocCount.count} payment allocations.`);

  // 3. Delete receipts
  const receiptCount = await prisma.receiptSubmission.deleteMany({});
  console.log(`Deleted ${receiptCount.count} receipt submissions.`);

  // 4. Delete payment records
  const payCount = await prisma.paymentRecord.deleteMany({});
  console.log(`Deleted ${payCount.count} payment records.`);

  // 5. Delete society documents and customer documents
  const socDocCount = await prisma.societyDocument.deleteMany({});
  console.log(`Deleted ${socDocCount.count} society documents.`);

  const custDocCount = await prisma.customerDocument.deleteMany({});
  console.log(`Deleted ${custDocCount.count} customer documents.`);

  // 6. Delete customer strikes
  const strikeCount = await prisma.customerStrike.deleteMany({});
  console.log(`Deleted ${strikeCount.count} customer strikes.`);

  // 7. Delete reservations
  const resCount = await prisma.reservation.deleteMany({});
  console.log(`Deleted ${resCount.count} reservations.`);

  // 8. Delete bookings
  const bookCount = await prisma.booking.deleteMany({});
  console.log(`Deleted ${bookCount.count} bookings.`);

  // 9. Clear owner on all plots before deleting customers
  const clearOwners = await prisma.plot.updateMany({
    where: { currentOwnerId: { not: null } },
    data: { currentOwnerId: null },
  });
  console.log(`Cleared currentOwnerId on ${clearOwners.count} plots.`);

  // 10. Delete all customers
  const delCustCount = await prisma.customer.deleteMany({});
  console.log(`Deleted ${delCustCount.count} customers.`);

  // 11. For every residential or commercial plot that is reserved, booked, allotted, or marked adjustment:
  // - set status to available
  // - clear currentOwnerId
  // - clear the lock
  // - clear isAdjustment
  // - write one PlotStatusHistory row to available at the time of this cleanup
  const plotsToReset = await prisma.plot.findMany({
    where: {
      category: { in: ['residential', 'commercial'] },
      OR: [
        { status: { not: 'available' } },
        { isAdjustment: true },
        { lockedBy: { not: null } },
        { currentOwnerId: { not: null } },
      ],
    },
    select: {
      id: true,
      blockId: true,
      plotNumber: true,
      status: true,
    },
  });

  console.log(`\nFound ${plotsToReset.length} residential/commercial plots needing reset to available:`);
  const now = new Date();

  for (const p of plotsToReset) {
    console.log(`- Resetting ${p.blockId} #${p.plotNumber} from ${p.status} to available`);
    await prisma.plot.update({
      where: { id: p.id },
      data: {
        status: PlotStatus.available,
        currentOwnerId: null,
        lockedBy: null,
        lockedAt: null,
        isAdjustment: false,
        adjustmentReason: null,
        adjustmentDate: null,
        adjustmentBy: null,
      },
    });

    await prisma.plotStatusHistory.create({
      data: {
        plotId: p.id,
        fromStatus: p.status,
        toStatus: PlotStatus.available,
        changedAt: now,
        changedBy: 'admin',
        reason: 'Cleanup test data and reset status to available',
        source: 'cleanup',
      },
    });
  }

  // Clear any adjustments on amenities if any
  const amenityAdjustments = await prisma.plot.updateMany({
    where: {
      category: 'amenity',
      OR: [
        { isAdjustment: true },
        { lockedBy: { not: null } },
        { currentOwnerId: { not: null } },
      ],
    },
    data: {
      isAdjustment: false,
      adjustmentReason: null,
      adjustmentDate: null,
      adjustmentBy: null,
      lockedBy: null,
      lockedAt: null,
      currentOwnerId: null,
    },
  });
  if (amenityAdjustments.count > 0) {
    console.log(`Cleared adjustments on ${amenityAdjustments.count} amenity plots.`);
  }

  // 12. Remove plots that are not drawn on that map only when it has no owner, no booking, and no payment.
  const unmappedPlotIdentifiers = [
    { blockId: 'abbott', plotNumber: 'A-01' },
    { blockId: 'abbott', plotNumber: 'A-02' },
    { blockId: 'abbott', plotNumber: 'A-03' },
    { blockId: 'abbott', plotNumber: 'A-04' },
    { blockId: 'abbott', plotNumber: 'A-05' },
    { blockId: 'abbott', plotNumber: 'A-12' },
    { blockId: 'abbott', plotNumber: 'A-14' },
    { blockId: 'royal', plotNumber: 'B-05' },
    { blockId: 'royal', plotNumber: 'R-01' },
    { blockId: 'overseas', plotNumber: 'C-08' },
    { blockId: 'overseas', plotNumber: 'C-09' },
    { blockId: 'overseas', plotNumber: 'OV-03' },
    { blockId: 'overseas', plotNumber: 'OV-04' },
    { blockId: 'elite', plotNumber: '155-2' },
    { blockId: 'elite', plotNumber: 'CH-02' },
    { blockId: 'npf-phase-2', plotNumber: 'AMN-G03' },
    { blockId: 'npf-phase-2', plotNumber: 'AMN-GY01' },
    { blockId: 'npf-phase-2', plotNumber: 'NPF2-01' },
    { blockId: 'npf-phase-2', plotNumber: 'NPF2-02' },
    { blockId: 'npf-phase-2', plotNumber: 'NPF2-03' },
    { blockId: 'npf-phase-2', plotNumber: 'NPF2-04' },
  ];

  for (const target of unmappedPlotIdentifiers) {
    const plotRow = await prisma.plot.findFirst({
      where: { blockId: target.blockId, plotNumber: target.plotNumber },
      include: { bookings: true, currentOwner: true },
    });
    if (plotRow) {
      if (!plotRow.currentOwnerId && plotRow.bookings.length === 0) {
        await prisma.plotStatusHistory.deleteMany({ where: { plotId: plotRow.id } });
        await prisma.plot.delete({ where: { id: plotRow.id } });
        console.log(`Deleted unmapped unowned plot ${target.blockId} #${target.plotNumber}`);
      } else {
        console.warn(`Skipping deletion of ${target.blockId} #${target.plotNumber} because owner/booking still exists!`);
      }
    }
  }

  // 13. Delete npf-phase-2 block from Block table since it has no map and no plots
  const p2PlotsCount = await prisma.plot.count({ where: { blockId: 'npf-phase-2' } });
  if (p2PlotsCount === 0) {
    const p2Block = await prisma.block.findUnique({ where: { id: 'npf-phase-2' } });
    if (p2Block) {
      await prisma.blockAssignment.deleteMany({ where: { blockId: 'npf-phase-2' } });
      await prisma.block.delete({ where: { id: 'npf-phase-2' } });
      console.log('Deleted block npf-phase-2 from Block table.');
    }
  }

  // 14. Update Elite plot 169:
  // On the Elite map, plot 169 is residential 42.5 Marla.
  // ac74323c-606f-43bf-9fcd-e600103fbbb4 is the Prime View Club with plotNumber: "" (stays an amenity).
  const plot169 = await prisma.plot.findFirst({ where: { blockId: 'elite', plotNumber: '169' } });
  if (plot169 && plot169.category === 'amenity') {
    await prisma.plot.update({
      where: { id: plot169.id },
      data: {
        category: 'residential',
        size: '42.5 Marla',
        plotType: '42.5_marla',
        amenityName: null,
        status: PlotStatus.available,
        currentOwnerId: null,
      },
    });
    console.log('Updated Elite plot 169 to residential 42.5 Marla matching map area.');
  }

  console.log('\n=== CLEANUP COMPLETED SUCCESSFULLY ===');
}

main().finally(() => prisma.$disconnect());
