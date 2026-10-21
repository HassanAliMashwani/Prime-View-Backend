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
  const blocks = await prisma.block.findMany({ orderBy: { id: 'asc' } });
  for (const b of blocks) {
    const plots = await prisma.plot.findMany({
      where: { blockId: b.id },
      orderBy: { plotNumber: 'asc' },
    });
    console.log(`\n========================================`);
    console.log(`BLOCK: ${b.name} (${b.id}) - Total: ${plots.length}`);
    const nonNumeric = plots.filter((p) => isNaN(Number(p.plotNumber)));
    console.log(`Non-numeric plot numbers (${nonNumeric.length}):`, nonNumeric.map((p) => `${p.plotNumber} [${p.category}, status:${p.status}]`));
    
    const numeric = plots.filter((p) => !isNaN(Number(p.plotNumber))).map((p) => Number(p.plotNumber)).sort((a, b) => a - b);
    if (numeric.length > 0) {
      console.log(`Numeric range: min=${numeric[0]}, max=${numeric[numeric.length - 1]}, count=${numeric.length}`);
      // Find missing numbers or duplicates
      const numSet = new Set(numeric);
      const dups = numeric.filter((n, idx) => numeric.indexOf(n) !== idx);
      if (dups.length > 0) {
        console.log(`Duplicates:`, Array.from(new Set(dups)));
      }
    }

    const amenities = plots.filter((p) => p.category === 'amenity');
    console.log(`Amenities (${amenities.length}):`, amenities.map((p) => `${p.plotNumber} (${p.amenityName})`));

    const residential = plots.filter((p) => p.category === 'residential');
    console.log(`Residential count: ${residential.length}`);

    const commercial = plots.filter((p) => p.category === 'commercial');
    console.log(`Commercial count: ${commercial.length}`);
  }
}

main().finally(() => prisma.$disconnect());
