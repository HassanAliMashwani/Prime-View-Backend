import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } } });
async function main() {
  const policies: any[] = await prisma.$queryRaw`
    SELECT tablename, policyname, cmd, qual, with_check 
    FROM pg_policies 
    WHERE tablename IN ('PaymentRecord', 'SocietyDocument', 'Reservation')
    ORDER BY tablename, policyname
  `;
  for (const p of policies) {
    console.log(`${p.tablename} | ${p.policyname} | ${p.cmd} | qual: ${p.qual} | check: ${p.with_check}`);
  }
}
main().finally(() => prisma.$disconnect());
