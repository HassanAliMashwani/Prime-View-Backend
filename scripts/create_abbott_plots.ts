import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
  },
});

const FRONTEND_MAP_DIR = path.resolve(__dirname, '../../Prime View frontend/src/lib/map');

function extractAreasFromTs(filePath: string): any[] {
  const content = fs.readFileSync(filePath, 'utf8');
  const start = content.indexOf('= [');
  if (start === -1) {
    throw new Error(`Could not find '= [' in ${filePath}`);
  }
  const arrayStart = start + 2;
  const arrayEnd = content.indexOf('];', arrayStart);
  if (arrayEnd === -1) {
    throw new Error(`Could not find '];' in ${filePath}`);
  }
  const jsonStr = content.substring(arrayStart, arrayEnd + 1);
  return JSON.parse(jsonStr);
}

function normalizeNumber(numStr: string): string {
  const stripped = numStr.trim().replace(/^[a-z]+-/i, '').toLowerCase();
  const unpadded = stripped.replace(/^0+/, '');
  return unpadded || stripped;
}

async function run() {
  const abbottAreas = extractAreasFromTs(path.join(FRONTEND_MAP_DIR, 'abbottBlockAreas.ts'));
  console.log(`Loaded ${abbottAreas.length} shapes from abbottBlockAreas.ts`);

  // Existing plots in DB for Abbott
  const existingPlots = await prisma.plot.findMany({
    where: { blockId: 'abbott' },
  });
  console.log(`Existing Abbott plots in DB: ${existingPlots.length}`);

  const existingNormalized = new Set<string>();
  for (const p of existingPlots) {
    existingNormalized.add(p.plotNumber.trim().toLowerCase());
    existingNormalized.add(normalizeNumber(p.plotNumber));
  }

  const toCreate: any[] = [];
  const processed = new Set<string>();

  for (const a of abbottAreas) {
    if (!a.plotNumber || typeof a.plotNumber !== 'string' || !a.plotNumber.trim()) {
      continue;
    }
    const cleanNum = a.plotNumber.trim();
    const lowerNum = cleanNum.toLowerCase();
    const norm = normalizeNumber(cleanNum);

    if (processed.has(lowerNum) || existingNormalized.has(lowerNum) || existingNormalized.has(norm)) {
      continue;
    }

    processed.add(lowerNum);
    toCreate.push({
      blockId: 'abbott',
      plotNumber: cleanNum,
      category: a.category,
      size: a.sizeLabel || 'Standard',
      amenityName: a.amenityName || a.amenityType || null,
      plotType: a.category === 'commercial' ? 'commercial' : a.category === 'amenity' ? 'amenity' : 'standard',
      price: 0,
      status: 'available',
      isAdjustment: false,
      version: 0,
    });
  }

  console.log(`Abbott plots to create: ${toCreate.length}`);
  if (toCreate.length > 0) {
    console.log('Sample plots to create:', toCreate.slice(0, 3));
  }

  let createdCount = 0;
  for (const plotData of toCreate) {
    await prisma.plot.create({ data: plotData });
    createdCount++;
  }

  console.log(`Successfully created ${createdCount} plots for Abbott Block.`);

  const finalTotal = await prisma.plot.count({ where: { blockId: 'abbott' } });
  console.log(`Final total Abbott plots in DB: ${finalTotal}`);
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
