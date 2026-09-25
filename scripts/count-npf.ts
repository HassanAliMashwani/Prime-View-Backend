import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } } });
async function main() {
  const total = await prisma.plot.count({ where: { blockId: "npf-phase-1" } });
  console.log("NPF-Phase-1 total plots in DB:", total);
  if (total === 0) {
    console.log("RESULT: EMPTY - safe to seed");
  } else {
    const rows = await prisma.plot.findMany({
      where: { blockId: "npf-phase-1" },
      select: { plotNumber: true, category: true, status: true },
      orderBy: { plotNumber: "asc" },
      take: 10
    });
    console.log("RESULT: HAS DATA - do not seed. Sample:", JSON.stringify(rows, null, 2));
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
