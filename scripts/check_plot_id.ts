import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } } });
async function main() {
  const p = await prisma.plot.findFirst({ where: { blockId: 'elite', plotNumber: '238' } });
  console.log('Plot 238 in Elite:', p);
}
main().finally(() => prisma.$disconnect());
