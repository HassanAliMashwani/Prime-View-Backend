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

// Load areas from frontend
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

async function run() {
  const royalAreas = extractAreasFromTs(path.join(FRONTEND_MAP_DIR, 'royalBlockAreas.ts'));
  const overseasAreas = extractAreasFromTs(path.join(FRONTEND_MAP_DIR, 'overseasBlockAreas.ts'));

  console.log(`Loaded ${royalAreas.length} shapes from royalBlockAreas.ts`);
  console.log(`Loaded ${overseasAreas.length} shapes from overseasBlockAreas.ts`);

  // Existing plots in DB
  const existingRoyalPlots = await prisma.plot.findMany({
    where: { blockId: 'royal' },
    select: { plotNumber: true },
  });
  const existingRoyalNumbers = new Set(existingRoyalPlots.map((p) => p.plotNumber.trim().toLowerCase()));

  const existingOverseasPlots = await prisma.plot.findMany({
    where: { blockId: 'overseas' },
    select: { plotNumber: true },
  });
  const existingOverseasNumbers = new Set(existingOverseasPlots.map((p) => p.plotNumber.trim().toLowerCase()));

  console.log(`Existing Royal plot count in DB: ${existingRoyalPlots.length}`);
  console.log(`Existing Overseas plot count in DB: ${existingOverseasPlots.length}`);

  // Process Royal
  const royalToCreate: any[] = [];
  const processedRoyalNumbers = new Set<string>();

  for (const a of royalAreas) {
    if (!a.plotNumber || typeof a.plotNumber !== 'string' || !a.plotNumber.trim()) {
      continue;
    }
    const cleanNum = a.plotNumber.trim();
    const lowerNum = cleanNum.toLowerCase();

    if (processedRoyalNumbers.has(lowerNum) || existingRoyalNumbers.has(lowerNum)) {
      continue;
    }

    processedRoyalNumbers.add(lowerNum);
    royalToCreate.push({
      blockId: 'royal',
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

  // Process Overseas
  const overseasToCreate: any[] = [];
  const processedOverseasNumbers = new Set<string>();

  for (const a of overseasAreas) {
    if (!a.plotNumber || typeof a.plotNumber !== 'string' || !a.plotNumber.trim()) {
      continue;
    }
    const cleanNum = a.plotNumber.trim();
    const lowerNum = cleanNum.toLowerCase();

    if (processedOverseasNumbers.has(lowerNum) || existingOverseasNumbers.has(lowerNum)) {
      continue;
    }

    processedOverseasNumbers.add(lowerNum);
    overseasToCreate.push({
      blockId: 'overseas',
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

  console.log(`Royal plots to create: ${royalToCreate.length}`);
  console.log(`Overseas plots to create: ${overseasToCreate.length}`);
  console.log('Sample Royal to create:', royalToCreate.slice(0, 3));
  console.log('Sample Overseas to create:', overseasToCreate.slice(0, 3));

  // Insert into DB
  console.log('Inserting Royal plots...');
  let royalCreated = 0;
  for (const plotData of royalToCreate) {
    await prisma.plot.create({ data: plotData });
    royalCreated++;
  }

  console.log('Inserting Overseas plots...');
  let overseasCreated = 0;
  for (const plotData of overseasToCreate) {
    await prisma.plot.create({ data: plotData });
    overseasCreated++;
  }

  console.log(`Successfully created ${royalCreated} plots for Royal.`);
  console.log(`Successfully created ${overseasCreated} plots for Overseas.`);
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
