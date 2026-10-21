/// <reference types="node" />
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } },
});

async function main() {
  const plots = await prisma.plot.findMany({
    where: { blockId: 'elite' },
    include: { _count: { select: { bookings: true, reservations: true, statusHistory: true } } },
  });
  console.log('elite total', plots.length);
  const nums = plots.map((p) => p.plotNumber);
  const nonNumeric = plots.filter((p) => !/^\d+$/.test(p.plotNumber));
  console.log('non-numeric:', nonNumeric.map((p) => `${p.plotNumber}|${p.category}|${p.amenityName}|${p.size}|${p.status}`));
  for (let i = 168; i <= 235; i++) {
    const p = plots.find((x) => x.plotNumber === String(i));
    console.log(
      i,
      p
        ? `${p.category} ${p.plotType} ${p.size} price=${p.price} ${p.status} owner=${p.currentOwnerId ? 'Y' : 'N'} bk=${p._count.bookings} rs=${p._count.reservations} amen=${p.amenityName} adj=${p.isAdjustment}`
        : 'NOT FOUND',
    );
  }
  const clubs = plots.filter((p) => p.amenityName && /club/i.test(p.amenityName));
  console.log('clubs', clubs.map((p) => ({ id: p.id, n: p.plotNumber, a: p.amenityName, size: p.size, t: p.plotType })));
  const ch = await prisma.plot.findMany({ where: { plotNumber: { startsWith: 'CH' } } });
  console.log('CH rows', ch.map((p) => `${p.blockId}:${p.plotNumber}:${p.category}:${p.status}`));
}

main().finally(() => prisma.$disconnect());
