import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } },
});

async function main() {
  const plots = await prisma.plot.findMany({
    where: { blockId: 'elite' },
    select: {
      id: true,
      plotNumber: true,
      plotType: true,
      category: true,
      size: true,
      price: true,
      status: true,
      currentOwnerId: true,
      amenityName: true,
    },
    orderBy: { plotNumber: 'asc' },
  });

  console.log('Total plots in elite:', plots.length);

  // Check 170..233
  const range = [];
  for (let i = 170; i <= 233; i++) {
    const p = plots.find(x => x.plotNumber === String(i));
    if (p) {
      range.push(`${p.plotNumber}: id=${p.id}, cat=${p.category}, status=${p.status}, size=${p.size}, price=${p.price}, owner=${p.currentOwnerId}`);
    } else {
      range.push(`${i}: NOT FOUND`);
    }
  }
  console.log(range.join('\n'));

  // Check amenities
  const amenities = plots.filter(x => x.category === 'amenity');
  console.log('\nAmenities in elite:');
  amenities.forEach(a => console.log(`${a.plotNumber}: id=${a.id}, name=${a.amenityName}, size=${a.size}`));
}

main().finally(() => prisma.$disconnect());
