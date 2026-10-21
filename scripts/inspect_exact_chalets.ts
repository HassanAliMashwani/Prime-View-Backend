/// <reference types="node" />
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } },
});

async function main() {
  const plots = await prisma.plot.findMany({
    where: {
      blockId: 'elite',
      OR: [
        { plotNumber: { in: Array.from({ length: 65 }, (_, i) => String(170 + i)) } },
        { amenityName: { contains: 'Club', mode: 'insensitive' } },
        { plotNumber: '' },
      ],
    },
    include: {
      bookings: true,
      reservations: true,
      currentOwner: true,
    },
    orderBy: { plotNumber: 'asc' },
  });

  console.log(`Found ${plots.length} relevant rows:`);
  for (const p of plots) {
    console.log(
      `ID: ${p.id} | PN: "${p.plotNumber}" | cat: ${p.category} | size: ${p.size} | price: ${p.price} | status: ${p.status} | ownerId: ${p.currentOwnerId} | bookings: ${p.bookings.length} | res: ${p.reservations.length} | amen: "${p.amenityName}"`
    );
  }
}

main().finally(() => prisma.$disconnect());
