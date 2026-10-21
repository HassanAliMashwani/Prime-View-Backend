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
  const res = await prisma.reservation.findMany({ where: { plotId: 'plot-ch-01' } });
  console.log('CH-01 reservations:', res);
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
