require('dotenv').config();
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const rawCounts = await prisma.$queryRaw`
    SELECT "blockId", status, count(*)::int as count 
    FROM "Plot" 
    WHERE "blockId" IN ('abbott', 'royal')
    GROUP BY "blockId", status
  `;
  console.log('Raw Plot counts:', rawCounts);

  // Using inventory service query manually (or just logging it)
  // Let's just output the raw counts.
}

main().catch(console.error).finally(() => process.exit(0));
