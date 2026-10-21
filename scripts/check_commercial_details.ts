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
      blockId: 'commercial',
      plotNumber: { in: ['AMN-GS01', 'AMN-C02'] },
    },
    include: {
      currentOwner: true,
      bookings: true,
      reservations: true,
    },
  });

  for (const p of plots) {
    console.log({
      plotNumber: p.plotNumber,
      status: p.status,
      owner: p.currentOwner?.fullName,
      bookingsCount: p.bookings.length,
      reservationsCount: p.reservations.length,
    });
  }
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
