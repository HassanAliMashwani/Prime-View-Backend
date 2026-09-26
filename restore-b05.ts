import { PrismaClient } from '@prisma/client';

import * as fs from 'fs';
import * as path from 'path';

let directUrl = '';
try {
  const envPath = path.resolve(__dirname, '.env');
  const envContent = fs.readFileSync(envPath, 'utf8');
  const match = envContent.match(/DIRECT_URL="(.*)"/);
  if (match) directUrl = match[1];
} catch(e) {}

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: directUrl || process.env.DIRECT_URL,
    },
  },
});

async function run() {
  const booking = await prisma.booking.findUnique({ where: { id: 'book-2' } });
  if (!booking) throw new Error('Booking not found');

  const baseAmount = 270833;

  await prisma.paymentRecord.updateMany({
    where: {
      bookingId: booking.id,
      installmentNumber: { in: [1, 2, 3, 4, 5, 6, 7] },
    },
    data: {
      status: 'paid',
      paidAmount: baseAmount,
      transactionRef: null,
      paidDate: null,
    },
  });

  await prisma.paymentRecord.updateMany({
    where: {
      bookingId: booking.id,
      installmentNumber: 8,
    },
    data: {
      status: 'overdue',
      paidAmount: 0,
      transactionRef: null,
      paidDate: null,
    },
  });

  await prisma.paymentRecord.updateMany({
    where: {
      bookingId: booking.id,
      installmentNumber: { in: [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23] },
    },
    data: {
      status: 'pending',
      amount: baseAmount,
      paidAmount: 0,
      transactionRef: null,
      paidDate: null,
    },
  });

  await prisma.paymentRecord.updateMany({
    where: {
      bookingId: booking.id,
      installmentNumber: 24,
    },
    data: {
      status: 'pending',
      amount: 270841,
      paidAmount: 0,
      transactionRef: null,
      paidDate: null,
    },
  });

  const all = await prisma.paymentRecord.findMany({
    where: { bookingId: booking.id },
    orderBy: { installmentNumber: 'asc' },
  });

  console.log("installmentNumber | amount | paidAmount | status | paidDate | transactionRef");
  for (const r of all) {
    const paidDate = r.paidDate ? r.paidDate.toISOString().split('T')[0] : 'null';
    console.log(`${r.installmentNumber} | ${r.amount} | ${r.paidAmount} | ${r.status} | ${paidDate} | ${r.transactionRef || 'null'}`);
  }

  await prisma.$disconnect();
}

run().catch(console.error);
