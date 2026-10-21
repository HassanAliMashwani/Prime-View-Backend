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
  const blocks = await prisma.$queryRaw<Array<{
    id: string;
    name: string;
    totalPlots: number;
    availableCount: number;
    reservedCount: number;
    bookedCount: number;
    allottedCount: number;
  }>>`
    SELECT 
      b.id,
      b.name,
      COUNT(p.id) FILTER (WHERE p.category != 'amenity')::int as "totalPlots",
      COUNT(p.id) FILTER (WHERE p.category != 'amenity')::int as "totalCount",
      COUNT(p.id) FILTER (WHERE p.category != 'amenity' AND p.status = 'available' AND p."isAdjustment" = false)::int as "availableCount",
      COUNT(p.id) FILTER (WHERE p.category != 'amenity' AND p.status = 'reserved' AND p."isAdjustment" = false)::int as "reservedCount",
      COUNT(p.id) FILTER (WHERE p.category != 'amenity' AND p.status = 'booked' AND p."isAdjustment" = false)::int as "bookedCount",
      COUNT(p.id) FILTER (WHERE p.category != 'amenity' AND p.status = 'allotted' AND p."isAdjustment" = false)::int as "allottedCount"
    FROM "Block" b
    LEFT JOIN "Plot" p ON p."blockId" = b.id
    GROUP BY b.id, b.name
    ORDER BY b.id ASC
  `;

  console.table(blocks);
  const total = blocks.reduce((sum, b) => sum + b.totalPlots, 0);
  console.log('Total across all visible blocks:', total);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
