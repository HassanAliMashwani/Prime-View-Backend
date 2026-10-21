import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } } });
async function main() {
  const plots = await prisma.plot.findMany({ 
    where: { blockId: 'elite', status: 'available', price: { gt: 0 } },
    select: { id: true, plotNumber: true, price: true, status: true }
  });
  console.log('Available priced plots in Elite:', plots.slice(0, 10));
}
main().finally(() => prisma.$disconnect());
