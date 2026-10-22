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

const prisma = new PrismaClient({
  datasources: { db: { url: getDirectUrl() } }
});

async function run() {
  const receipts = await prisma.receiptSubmission.findMany({
    select: {
      id: true,
      slipNumber: true,
      slipNumberFormatVersion: true,
      receiptFileUrl: true,
      status: true,
      uploadedAt: true,
    }
  });
  console.log(`ReceiptSubmission count: ${receipts.length}`);
  for (const r of receipts) {
    console.log(`  Receipt id=${r.id}, slipNumber=${r.slipNumber}, v=${r.slipNumberFormatVersion}, status=${r.status}, fileUrl=${r.receiptFileUrl?.slice(0, 50)}...`);
  }

  const reservations = await prisma.receiptNumberReservation.findMany();
  console.log(`\nReceiptNumberReservation count: ${reservations.length}`);
  for (const res of reservations) {
    console.log(`  Reservation id=${res.id}, slipNumber=${res.slipNumber}, status=${res.status}, receiptId=${res.receiptId}`);
  }

  // Also check file fields in CustomerDocument, SocietyDocument, Customer
  const custDocs = await prisma.customerDocument.findMany({
    select: { id: true, fileUrl: true, fileName: true, type: true }
  });
  console.log(`\nCustomerDocument count: ${custDocs.length}`);
  for (const cd of custDocs) {
    console.log(`  CustDoc id=${cd.id}, type=${cd.type}, url=${cd.fileUrl?.slice(0, 50)}...`);
  }

  const socDocs = await prisma.societyDocument.findMany({
    select: { id: true, fileUrl: true, fileName: true, type: true }
  });
  console.log(`\nSocietyDocument count: ${socDocs.length}`);
  for (const sd of socDocs) {
    console.log(`  SocDoc id=${sd.id}, type=${sd.type}, url=${sd.fileUrl?.slice(0, 50)}...`);
  }

  // Customer photo fields?
  // Let's check Customer fields in Prisma schema
}

run().catch(console.error).finally(() => prisma.$disconnect());
