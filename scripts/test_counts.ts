import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
  },
});

async function run() {
  const plotCount = await prisma.plot.count();
  const blockCount = await prisma.block.count();
  const blocks = await prisma.block.findMany({
    include: { _count: { select: { plots: true } } },
    orderBy: { id: 'asc' },
  });
  console.log('Total plots:', plotCount);
  console.log('Total blocks:', blockCount);
  console.log('Blocks:', blocks);

  const plotsByStatus = await prisma.plot.groupBy({
    by: ['status'],
    _count: { id: true },
  });
  console.log('Plots by status:', plotsByStatus);

  const plotsByCategory = await prisma.plot.groupBy({
    by: ['category'],
    _count: { id: true },
  });
  console.log('Plots by category:', plotsByCategory);

  const customers = await prisma.customer.findMany({
    select: { id: true, fullName: true, membershipNo: true },
  });
  console.log('Customers count:', customers.length);
  console.log('Customers:', customers);

  const bookings = await prisma.booking.findMany({
    select: { id: true, plotId: true, customerId: true, status: true },
  });
  console.log('Bookings count:', bookings.length);

  const reservations = await prisma.reservation.findMany({
    select: { id: true, plotId: true, customerId: true, status: true },
  });
  console.log('Reservations count:', reservations.length);
}

run().catch(console.error).finally(() => prisma.$disconnect());
