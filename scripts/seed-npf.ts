import { PrismaClient, PlotStatus, PlotCategory } from '@prisma/client';
import { readFileSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } }
});

const RESIDENTIAL_RANGES = [[1, 44], [82, 218], [220, 233], [235, 245], [248, 253]];
const COMMERCIAL_RANGES = [[46, 73]];
const AMENITY_NAMES: Record<number, string> = {
  4: 'Graveyard',
  45: 'Commercial Park',
  74: 'Apartment Block',
  75: 'Community Park',
  76: 'T-Plant',
  77: 'School',
  78: 'Playground',
  79: 'Mosque',
  80: 'Hospital',
  81: 'Community Center',
  219: 'Filtration Plant',
  234: 'Open Garden',
  247: 'Grid Station',
  254: 'Amenity'
};

function inRanges(n: number, ranges: number[][]) { return ranges.some(([lo, hi]) => n >= lo && n <= hi); }

async function main() {
  console.log('Seeding NPF Phase 1...');

  // Ensure block exists
  await prisma.block.upsert({
    where: { id: 'npf-phase-1' },
    update: {},
    create: {
      id: 'npf-phase-1',
      name: 'NPF Phase 1',
      description: 'NPF Phase 1 Block',
      totalPlots: 254
    }
  });

  const existingPlots = await prisma.plot.findMany({
    where: { blockId: 'npf-phase-1' }
  });

  const existingByNumber = new Map(existingPlots.map(p => [p.plotNumber, p]));

  // Find a representative price to use if needed
  const sampleRes = await prisma.plot.findFirst({ where: { category: 'residential', price: { gt: 0 } } });
  const resPrice = sampleRes?.price || 15000000;
  
  const sampleCom = await prisma.plot.findFirst({ where: { category: 'commercial', price: { gt: 0 } } });
  const comPrice = sampleCom?.price || 35000000;

  for (let i = 1; i <= 254; i++) {
    const plotNumber = String(i);
    let category: PlotCategory = 'residential';
    let amenityName: string | null = null;
    let price = resPrice;
    let size = '1 Kanal'; // Default based on HTML

    if (AMENITY_NAMES[i]) {
      category = 'amenity';
      amenityName = AMENITY_NAMES[i];
      price = 0;
      size = 'Various';
    } else if (inRanges(i, COMMERCIAL_RANGES)) {
      category = 'commercial';
      price = comPrice;
      size = 'Commercial';
    } else if (inRanges(i, RESIDENTIAL_RANGES)) {
      category = 'residential';
      price = resPrice;
      size = '1 Kanal';
    } else {
      // Not in any defined range - fallback to amenity to be safe
      category = 'amenity';
      amenityName = 'Unassigned';
      price = 0;
      size = 'Various';
    }

    if (!existingByNumber.has(plotNumber)) {
      await prisma.plot.create({
        data: {
          id: `plot-npf1-${plotNumber}`,
          blockId: 'npf-phase-1',
          plotNumber,
          plotType: 'standard',
          category,
          amenityName,
          size,
          price,
          status: 'available',
          isAdjustment: false,
          version: 0
        }
      });
      console.log(`Created ${plotNumber} (${category})`);
    } else {
      const existing = existingByNumber.get(plotNumber)!;
      // "Fix plotNumber / category / amenityName only when status is available and there is no live booking."
      if (existing.status === 'available') {
        const hasBooking = await prisma.booking.findFirst({ where: { plotId: existing.id } });
        if (!hasBooking) {
          await prisma.plot.update({
            where: { id: existing.id },
            data: { category, amenityName, size }
          });
          console.log(`Updated existing ${plotNumber}`);
        }
      }
    }
  }

  // Delete the 6 placeholders if they are available and unbooked
  const placeholders = ['NPF1-01', 'NPF1-02', 'NPF1-03', 'NPF1-04', 'AMN-P03', 'AMN-S01'];
  for (const p of placeholders) {
    if (existingByNumber.has(p)) {
      const existing = existingByNumber.get(p)!;
      if (existing.status === 'available') {
        const hasBooking = await prisma.booking.findFirst({ where: { plotId: existing.id } });
        if (!hasBooking) {
          await prisma.plot.delete({ where: { id: existing.id } });
          console.log(`Deleted placeholder ${p}`);
        }
      }
    }
  }

  console.log('NPF Seeding Complete.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
