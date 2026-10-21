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
  console.log('--- CUSTOMERS ---');
  const customers = await prisma.customer.findMany({
    include: {
      _count: {
        select: {
          plots: true,
          bookings: true,
          reservations: true,
          strikes: true,
          receipts: true,
          documents: true,
        },
      },
    },
  });
  console.log(`Found ${customers.length} customers:`);
  for (const c of customers) {
    console.log(`- ${c.fullName} (${c.membershipNo || 'NO_MEMBERSHIP_NO'}, ID: ${c.id}) counts:`, c._count);
  }

  console.log('\n--- BOOKINGS ---');
  const bookings = await prisma.booking.findMany({
    include: {
      plot: { select: { plotNumber: true, blockId: true } },
      customer: { select: { fullName: true, membershipNo: true } },
      _count: { select: { payments: true } },
    },
  });
  console.log(`Found ${bookings.length} bookings:`);
  for (const b of bookings) {
    console.log(`- Booking ID ${b.id} for plot ${b.plot?.blockId} #${b.plot?.plotNumber}, customer: ${b.customer?.fullName} (${b.customer?.membershipNo}), status: ${b.status}, payments: ${b._count.payments}`);
  }

  console.log('\n--- RESERVATIONS ---');
  const reservations = await prisma.reservation.findMany({
    include: { plot: { select: { plotNumber: true, blockId: true } } },
  });
  console.log(`Found ${reservations.length} reservations:`);
  for (const r of reservations) {
    console.log(`- Reservation ${r.id} for plot ${r.plot?.blockId} #${r.plot?.plotNumber}, customer ${r.customerName}, status ${r.status}`);
  }

  console.log('\n--- NON-AVAILABLE OR ADJUSTMENT OR OWNED OR LOCKED PLOTS ---');
  const nonAvailPlots = await prisma.plot.findMany({
    where: {
      OR: [
        { status: { not: 'available' } },
        { isAdjustment: true },
        { currentOwnerId: { not: null } },
        { lockedBy: { not: null } },
      ],
    },
    select: {
      id: true,
      blockId: true,
      plotNumber: true,
      category: true,
      status: true,
      isAdjustment: true,
      lockedBy: true,
      lockedAt: true,
      currentOwnerId: true,
    },
  });
  console.log(`Found ${nonAvailPlots.length} non-available/locked/adjustment/owned plots:`);
  for (const p of nonAvailPlots) {
    console.log(`- ${p.blockId} #${p.plotNumber} [${p.category}] status=${p.status} isAdjustment=${p.isAdjustment} lockedBy=${p.lockedBy} owner=${p.currentOwnerId}`);
  }

  console.log('\n--- PLOTS GROUPED BY BLOCK & CATEGORY ---');
  const blocks = await prisma.block.findMany();
  for (const b of blocks) {
    const plots = await prisma.plot.findMany({ where: { blockId: b.id } });
    console.log(`Block ${b.name} (${b.id}): total=${plots.length}`);
    const cats: Record<string, number> = {};
    for (const p of plots) {
      cats[p.category] = (cats[p.category] || 0) + 1;
    }
    console.log(`  Categories:`, cats);
  }

  console.log('\n--- PLOT STATUS HISTORY COUNT ---');
  const histCount = await prisma.plotStatusHistory.count();
  console.log(`PlotStatusHistory total rows: ${histCount}`);
  const recentHist = await prisma.plotStatusHistory.findMany({
    take: 10,
    orderBy: { changedAt: 'desc' },
  });
  console.log('Recent 10 history rows:', recentHist);
}

main().finally(() => prisma.$disconnect());
