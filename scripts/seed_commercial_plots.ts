import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL
    }
  }
});

async function main() {
  // 1. Ensure Block exists
  const existingBlock = await prisma.block.findUnique({
    where: { id: 'commercial' }
  });

  if (!existingBlock) {
    await prisma.block.create({
      data: {
        id: 'commercial',
        name: 'Commercial Block',
        description: 'Main boulevard commercial hub for corporate offices, retail and food boulevards.',
        totalPlots: 108,
      }
    });
    console.log('Created Block row: commercial');
  } else {
    await prisma.block.update({
      where: { id: 'commercial' },
      data: { totalPlots: 108 }
    });
    console.log('Updated Block row: commercial (totalPlots: 108)');
  }

  // 2. Count before
  const plotsBefore = await prisma.plot.findMany({
    where: { blockId: 'commercial' }
  });
  console.log(`Commercial Plot rows BEFORE: ${plotsBefore.length}`);

  // 3. Align existing COM-01..04 if available and no live booking
  const comMap: Record<string, string> = {
    'COM-01': '1',
    'COM-02': '2',
    'COM-03': '3',
    'COM-04': '4',
  };

  for (const [oldNum, newNum] of Object.entries(comMap)) {
    const existing = plotsBefore.find(p => p.plotNumber === oldNum);
    if (existing && existing.status === 'available' && !existing.currentOwnerId) {
      await prisma.plot.update({
        where: { id: existing.id },
        data: {
          plotNumber: newNum,
          size: '4 Marla',
          plotType: 'commercial_4m',
          price: 15000000,
          category: 'commercial',
          isAdjustment: false,
        }
      });
      console.log(`Aligned ${oldNum} -> Plot ${newNum} (4 Marla, commercial)`);
    }
  }

  // 4. Fetch current plot numbers after alignment
  const currentPlots = await prisma.plot.findMany({
    where: { blockId: 'commercial' },
    select: { plotNumber: true }
  });
  const currentNumbers = new Set(currentPlots.map(p => p.plotNumber));

  // 5. Insert missing saleable plots 1 to 108
  let insertedCount = 0;
  for (let i = 1; i <= 108; i++) {
    const numStr = String(i);
    if (!currentNumbers.has(numStr)) {
      await prisma.plot.create({
        data: {
          blockId: 'commercial',
          plotNumber: numStr,
          size: '4 Marla',
          category: 'commercial',
          plotType: 'commercial_4m',
          price: 15000000,
          status: 'available',
          isAdjustment: false,
        }
      });
      insertedCount++;
    }
  }
  console.log(`Inserted ${insertedCount} missing saleable plots.`);

  // 6. Verify amenities exist and are marked properly
  const amenities = await prisma.plot.findMany({
    where: { blockId: 'commercial', category: 'amenity' }
  });
  console.log(`Commercial amenities count: ${amenities.length}`);
  for (const a of amenities) {
    console.log(`- Amenity ${a.plotNumber}: ${a.amenityName} (category=${a.category}, price=${a.price})`);
  }

  // 7. Count after
  const plotsAfter = await prisma.plot.findMany({
    where: { blockId: 'commercial' }
  });
  console.log(`Commercial Plot rows AFTER: ${plotsAfter.length}`);

  const saleableAfter = plotsAfter.filter(p => p.category === 'commercial');
  console.log(`Saleable commercial plots: ${saleableAfter.length}`);

  // 8. Sanity check: Ensure untouched blocks are untouched
  const eliteCount = await prisma.plot.count({ where: { blockId: 'elite' } });
  const npfCount = await prisma.plot.count({ where: { blockId: 'npf-phase-1' } });
  const plot233 = await prisma.plot.findFirst({ where: { blockId: 'elite', plotNumber: '233' } });
  console.log(`Sanity checks: Elite count=${eliteCount}, NPF count=${npfCount}, Elite 233 exists=${Boolean(plot233)}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
