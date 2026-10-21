import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } },
});

async function main() {
  const blockIds = ['abbott', 'commercial', 'royal', 'overseas', 'npf-phase-1', 'elite'];
  for (const bid of blockIds) {
    const allPlots = await prisma.plot.findMany({ where: { blockId: bid } });
    const lettered = allPlots.filter(p => isNaN(Number(p.plotNumber)) && p.plotNumber !== '');
    const numeric = allPlots.filter(p => !isNaN(Number(p.plotNumber)) && p.plotNumber !== '');
    const emptyPlot = allPlots.filter(p => p.plotNumber === '');

    const resOnly = numeric.filter(p => p.category === 'residential');
    const commOnly = numeric.filter(p => p.category === 'commercial');
    const amenOnly = numeric.filter(p => p.category === 'amenity');

    console.log(`\n=== BLOCK: ${bid} ===`);
    console.log(`Total rows in DB: ${allPlots.length}`);
    console.log(`Lettered rows (${lettered.length}):`, lettered.map(p => p.plotNumber));
    console.log(`Empty plotNumber rows (${emptyPlot.length}):`, emptyPlot.map(p => `${p.id} (${p.amenityName})`));
    console.log(`Numeric count: ${numeric.length}`);
    console.log(`  Residential: ${resOnly.length}`);
    console.log(`  Commercial: ${commOnly.length}`);
    console.log(`  Amenities: ${amenOnly.length}`);
    console.log(`  Res + Comm: ${resOnly.length + commOnly.length}`);
  }
}

main().finally(() => prisma.$disconnect());
