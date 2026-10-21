import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } } });
async function main() {
  const assignments = await prisma.blockAssignment.findMany({ where: { adminId: 'admin-3' } });
  console.log('Police assignments:', assignments);
}
main().finally(() => prisma.$disconnect());
