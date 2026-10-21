import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
  },
});

async function main() {
  const blocks = await prisma.block.findMany();
  for (const b of blocks) {
    const plots = await prisma.plot.findMany({ where: { blockId: b.id } });
    const avail = plots.filter(p => p.status === 'available').length;
    const res = plots.filter(p => p.status === 'reserved').length;
    const booked = plots.filter(p => p.status === 'booked').length;
    const allot = plots.filter(p => p.status === 'allotted').length;
    console.log(`${b.name} (${b.id}): ${avail} available, ${res} reserved, ${booked} booked, ${allot} allotted, total ${plots.length}`);
  }
}
main().finally(() => prisma.$disconnect());
