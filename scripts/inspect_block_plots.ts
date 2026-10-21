import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
  },
});

async function run() {
  const blocks = await prisma.block.findMany({
    include: {
      plots: {
        select: {
          id: true,
          plotNumber: true,
          category: true,
          status: true,
          isAdjustment: true,
          currentOwnerId: true,
        },
      },
    },
    orderBy: { id: 'asc' },
  });

  for (const b of blocks) {
    const total = b.plots.length;
    const resCom = b.plots.filter((p) => p.category === 'residential' || p.category === 'commercial');
    const amenities = b.plots.filter((p) => p.category === 'amenity');
    console.log(`\n=== Block ${b.id} (${b.name}) ===`);
    console.log(`Total DB plots: ${total}, Res+Com: ${resCom.length}, Amenity: ${amenities.length}`);
    
    // Find any plotNumber with non-digits or unusual numbers
    const lettered = b.plots.filter((p) => isNaN(Number(p.plotNumber)));
    console.log(`Non-numeric plot numbers (${lettered.length}):`, lettered.map((p) => `${p.plotNumber}(${p.category},${p.status})`));
    
    const numeric = b.plots.map((p) => Number(p.plotNumber)).filter((n) => !isNaN(n));
    if (numeric.length > 0) {
      console.log(`Numeric range: min=${Math.min(...numeric)}, max=${Math.max(...numeric)}, count=${numeric.length}`);
    }
  }
}

run().catch(console.error).finally(() => prisma.$disconnect());
