const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const { initEnv } = require('./env-helper');
const env = initEnv();

const prisma = new PrismaClient({
  datasources: { db: { url: env.DIRECT_URL || env.DATABASE_URL } }
});

async function run() {
  const plot = await prisma.plot.findUnique({
    where: { id: 'plot-ov-03' },
    select: { id: true, plotNumber: true, status: true, currentOwnerId: true },
  });
  console.log('--- Plot OV-03 State ---');
  console.log(plot);

  const reservations = await prisma.reservation.findMany({
    where: { plotId: 'plot-ov-03' },
    select: { id: true, customerName: true, status: true, tokenFee: true, createdAt: true, supersededAt: true, supersededByBookingId: true },
  });
  console.log('\n--- Reservations on Plot OV-03 ---');
  console.log(reservations);

  const bookings = await prisma.booking.findMany({
    where: { plotId: 'plot-ov-03' },
    select: { id: true, customerId: true, status: true, paymentType: true, bookingDate: true },
  });
  console.log('\n--- Bookings on Plot OV-03 ---');
  console.log(bookings);

  const audits = await prisma.auditEntry.findMany({
    where: {
      OR: [
        { entityType: 'plot', entityId: 'plot-ov-03' },
        { entityType: 'reservation', details: { contains: 'OV-03' } },
        { entityType: 'booking', details: { contains: 'OV-03' } },
      ],
    },
    select: { id: true, action: true, entityType: true, entityId: true, timestamp: true, details: true },
    orderBy: { timestamp: 'asc' },
  });
  console.log('\n--- Audit Entries for Plot OV-03 ---');
  console.log(JSON.stringify(audits, null, 2));

  await prisma.$disconnect();
}

run().catch(console.error);
