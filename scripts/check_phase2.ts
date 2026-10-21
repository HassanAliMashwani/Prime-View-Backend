import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } },
});

async function main() {
  const plots = await prisma.plot.findMany({ where: { blockId: 'npf-phase-2' } });
  const assignments = await prisma.blockAssignment.findMany({ where: { blockId: 'npf-phase-2' } });
  console.log('Plots with blockId npf-phase-2:', plots.length);
  console.log('Assignments with blockId npf-phase-2:', assignments.length);
}

main().finally(() => prisma.$disconnect());
