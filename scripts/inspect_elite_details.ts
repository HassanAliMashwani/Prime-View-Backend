import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } } });

async function main() {
  const plots = await prisma.plot.findMany({ where: { blockId: 'elite' } });
  console.log('Elite plots count:', plots.length);
  const p155_2 = plots.find(p => p.plotNumber === '155-2');
  console.log('155-2:', p155_2);
  const p155 = plots.find(p => p.plotNumber === '155');
  console.log('155:', p155);

  const booked = plots.filter(p => p.status === 'booked');
  console.log('Elite booked:', booked.map(p => ({ num: p.plotNumber, id: p.id })));
  const allotted = plots.filter(p => p.status === 'allotted');
  console.log('Elite allotted:', allotted.map(p => ({ num: p.plotNumber, id: p.id })));
}
main().finally(() => prisma.$disconnect());
