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
      blockId: 'abbott',
      plotNumber: { in: ['A-01', 'A-02', 'A-03', 'A-04', 'A-05', 'A-06', 'A-12', 'A-14', 'AMN-H01', 'AMN-M01'] },
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
      bookings: p.bookings.map(b => ({ id: b.id, status: b.status })),
      reservations: p.reservations.map(r => ({ id: r.id, status: r.status })),
    });
  }
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
