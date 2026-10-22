const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

function getDirectUrl() {
  const envContent = fs.readFileSync(path.join(__dirname, '../../.env'), 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('DIRECT_URL=')) {
      let val = trimmed.substring('DIRECT_URL='.length).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.substring(1, val.length - 1);
      }
      return val;
    }
  }
  return null;
}

const directUrl = getDirectUrl();

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: directUrl,
    },
  },
});

async function run() {
  const plotCount = await prisma.plot.count();
  console.log('Plot count via DIRECT_URL:', plotCount);

  // Group by category, status, isAdjustment
  const plots = await prisma.plot.findMany({
    select: {
      category: true,
      status: true,
      isAdjustment: true,
      currentOwnerId: true,
      lockedBy: true,
    }
  });

  const matrix = {
    amenity: { available: 0, reserved: 0, booked: 0, allotted: 0, disputed: 0, total: 0 },
    adjustment: { available: 0, reserved: 0, booked: 0, allotted: 0, disputed: 0, total: 0 },
    normal: { available: 0, reserved: 0, booked: 0, allotted: 0, disputed: 0, total: 0 }
  };

  let plotsWithCurrentOwner = 0;
  let plotsWithLockedBy = 0;

  for (const p of plots) {
    let type = 'normal';
    if (p.category === 'amenity') {
      type = 'amenity';
    } else if (p.isAdjustment) {
      type = 'adjustment';
    }

    if (matrix[type][p.status] !== undefined) {
      matrix[type][p.status]++;
    }
    matrix[type].total++;

    if (p.currentOwnerId) plotsWithCurrentOwner++;
    if (p.lockedBy) plotsWithLockedBy++;
  }

  console.table(matrix);
  console.log(`Total plots with currentOwnerId != null: ${plotsWithCurrentOwner}`);
  console.log(`Total plots with lockedBy != null: ${plotsWithLockedBy}`);
}

run().catch(console.error).finally(() => prisma.$disconnect());
