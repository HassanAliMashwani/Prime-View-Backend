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
  const p = await prisma.plot.findFirst({
    where: { blockId: 'royal', plotNumber: 'R-02' },
    include: { reservations: true, bookings: true },
  });
  console.log('R-02 in DB:', JSON.stringify(p, null, 2));
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
