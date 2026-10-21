import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const customers = await prisma.customer.findMany({
    select: { id: true, fullName: true, membershipNo: true, phone: true },
  });
  console.log('Customers count:', customers.length);
  console.log('Customers:', customers);

  const bookings = await prisma.booking.findMany({
    select: { id: true, plotId: true, customerId: true, status: true },
  });
  console.log('Bookings count:', bookings.length);
  console.log('Bookings:', bookings);

  const reservations = await prisma.reservation.findMany({
    select: { id: true, plotId: true, customerId: true, status: true },
  });
  console.log('Reservations count:', reservations.length);
  console.log('Reservations:', reservations);

  const nonAvailablePlots = await prisma.plot.findMany({
    where: {
      OR: [
        { status: { not: 'available' } },
        { currentOwnerId: { not: null } },
        { isAdjustment: true },
        { lockedBy: { not: null } },
      ],
    },
    select: { id: true, plotNumber: true, blockId: true, status: true, currentOwnerId: true, isAdjustment: true, category: true },
  });
  console.log('Non-available / owned / adjustment plots:', nonAvailablePlots.length);
  console.log(nonAvailablePlots);

  const allPlotsByBlock = await prisma.plot.groupBy({
    by: ['blockId', 'category', 'status'],
    _count: { id: true },
  });
  console.log('All plots by block, category, status:');
  console.table(allPlotsByBlock);
}

main().catch(console.error).finally(() => prisma.$disconnect());
