import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
  },
});

async function run() {
  const plots = await prisma.plot.findMany({
    where: {
      blockId: 'overseas',
      plotNumber: { in: ['OV-01', 'OV-02', 'C-08', 'AMN-C01', 'AMN-M02', 'C-09', 'OV-03', 'OV-04'] },
    },
    include: {
      currentOwner: true,
      bookings: {
        include: { payments: true }
      },
      reservations: true,
    },
  });

  for (const p of plots) {
    console.log({
      plotNumber: p.plotNumber,
      status: p.status,
      owner: p.currentOwner?.fullName,
      bookingsCount: p.bookings.length,
      paymentsCount: p.bookings.reduce((sum, b) => sum + b.payments.length, 0),
      reservationsCount: p.reservations.length,
    });
  }
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
