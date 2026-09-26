import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function run() {
  const sql = `EXPLAIN (ANALYZE, FORMAT JSON) 
    SELECT c.*,
      COALESCE(
        json_agg(json_build_object(
          'id', b.id,
          'plotId', p.id,
          'plotNumber', p."plotNumber",
          'blockName', b2."name",
          'totalPrice', b."totalPrice"
        )) FILTER (WHERE b.id IS NOT NULL),
        '[]'
      ) as plots
    FROM "Customer" c
    LEFT JOIN "Booking" b ON b."customerId" = c.id
    LEFT JOIN "Plot" p ON p.id = b."plotId"
    LEFT JOIN "Block" b2 ON b2.id = p."blockId"
    GROUP BY c.id
    LIMIT 20 OFFSET 0;
  `;
  try {
    const res = await prisma.$queryRawUnsafe(sql);
    console.log(JSON.stringify(res, null, 2));
  } catch (e) { console.error(e); }
  await prisma.$disconnect();
}
run();
