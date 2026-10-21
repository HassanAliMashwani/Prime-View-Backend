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
    where: { blockId: 'chalet' },
    include: {
      currentOwner: true,
      bookings: {
        include: {
          customer: true,
          payments: true,
        },
      },
      reservations: true,
    },
  });
  console.log(`Found ${plots.length} Chalet plots:`);
  for (const p of plots) {
    console.log({
      id: p.id,
      plotNumber: p.plotNumber,
      status: p.status,
      price: p.price.toString(),
      currentOwner: p.currentOwner ? { id: p.currentOwner.id, fullName: p.currentOwner.fullName, cnic: p.currentOwner.cnic } : null,
      bookings: p.bookings.map(b => ({
        id: b.id,
        status: b.status,
        customer: b.customer?.fullName,
        paymentsCount: b.payments.length,
      })),
      reservationsCount: p.reservations.length,
    });
  }

  const blockAssignments = await prisma.blockAssignment.findMany({
    where: { blockId: 'chalet' },
    include: { admin: { select: { id: true, username: true, role: true } } },
  });
  console.log(`Chalet block assignments:`, blockAssignments);
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
