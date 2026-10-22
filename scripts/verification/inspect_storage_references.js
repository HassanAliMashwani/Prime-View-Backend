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

function parseStorageUrl(rawUrl, defaultBucket = 'receipts') {
  if (!rawUrl) return null;
  const str = String(rawUrl).trim();

  // Check data: URL
  if (str.startsWith('data:')) {
    return { isDataUrl: true, raw: str.slice(0, 50) + '...' };
  }

  // Check format: "bucket:key"
  if (/^[a-zA-Z0-9_-]+:[^\s/]+/.test(str) && !str.startsWith('http://') && !str.startsWith('https://')) {
    const parts = str.split(':');
    return {
      bucket: parts[0],
      key: parts.slice(1).join(':'),
      isStorageObject: true,
      raw: str
    };
  }

  // Check Supabase public/authenticated URL:
  // e.g. https://xyz.supabase.co/storage/v1/object/public/receipts/...
  // e.g. https://xyz.supabase.co/storage/v1/object/authenticated/receipts/...
  // e.g. https://xyz.supabase.co/storage/v1/object/sign/receipts/...
  const supabaseMatch = str.match(/\/storage\/v1\/object\/(?:public|authenticated|sign)\/([a-zA-Z0-9_-]+)\/(.+?)(\?.*)?$/);
  if (supabaseMatch) {
    return {
      bucket: supabaseMatch[1],
      key: decodeURIComponent(supabaseMatch[2]),
      isStorageObject: true,
      raw: str
    };
  }

  // Check relative path e.g. /documents/...
  if (str.startsWith('/documents/')) {
    return {
      bucket: 'local-documents',
      key: str.substring(1),
      isStorageObject: false,
      isLocalDoc: true,
      raw: str
    };
  }

  // Any other URL or path
  return {
    bucket: defaultBucket,
    key: str,
    isStorageObject: true,
    raw: str
  };
}

async function main() {
  console.log('=== INSPECT STORAGE OBJECTS IN SCOPED ROWS ===\n');

  // 1. ReceiptSubmission
  const receipts = await prisma.receiptSubmission.findMany({
    select: {
      id: true,
      slipNumber: true,
      receiptFileUrl: true,
    }
  });

  const receiptObjects = [];
  let receiptDataUrls = 0;

  for (const r of receipts) {
    const parsed = parseStorageUrl(r.receiptFileUrl, 'receipts');
    if (!parsed) continue;
    if (parsed.isDataUrl) {
      receiptDataUrls++;
    } else {
      receiptObjects.push({
        sourceTable: 'ReceiptSubmission',
        recordId: r.id,
        slipNumber: r.slipNumber,
        bucket: parsed.bucket,
        key: parsed.key,
        rawUrl: r.receiptFileUrl,
      });
    }
  }

  console.log(`ReceiptSubmission: ${receipts.length} rows`);
  console.log(`  - Storage objects: ${receiptObjects.length}`);
  console.log(`  - Data: URLs: ${receiptDataUrls}`);
  receiptObjects.forEach((o, i) => {
    console.log(`  [${i+1}] bucket="${o.bucket}", key="${o.key}" (slip=${o.slipNumber || 'none'})`);
  });

  // 2. CustomerDocument
  const custDocs = await prisma.customerDocument.findMany({
    select: {
      id: true,
      customerId: true,
      type: true,
      fileName: true,
      fileUrl: true,
    }
  });

  const custDocObjects = [];
  let custDocDataUrls = 0;

  for (const cd of custDocs) {
    const parsed = parseStorageUrl(cd.fileUrl, 'customer-documents');
    if (!parsed) continue;
    if (parsed.isDataUrl) {
      custDocDataUrls++;
    } else {
      custDocObjects.push({
        sourceTable: 'CustomerDocument',
        recordId: cd.id,
        customerId: cd.customerId,
        type: cd.type,
        fileName: cd.fileName,
        bucket: parsed.bucket,
        key: parsed.key,
        rawUrl: cd.fileUrl,
      });
    }
  }

  console.log(`\nCustomerDocument: ${custDocs.length} rows`);
  console.log(`  - Storage objects: ${custDocObjects.length}`);
  console.log(`  - Data: URLs: ${custDocDataUrls}`);
  custDocObjects.forEach((o, i) => {
    console.log(`  [${i+1}] bucket="${o.bucket}", key="${o.key}" (type=${o.type}, file=${o.fileName})`);
  });

  // 3. SocietyDocument
  const socDocs = await prisma.societyDocument.findMany({
    select: {
      id: true,
      bookingId: true,
      customerId: true,
      type: true,
      fileName: true,
      fileUrl: true,
    }
  });

  const socDocObjects = [];
  let socDocDataUrls = 0;
  let socDocLocalPaths = 0;

  for (const sd of socDocs) {
    const parsed = parseStorageUrl(sd.fileUrl, 'customer-documents');
    if (!parsed) continue;
    if (parsed.isDataUrl) {
      socDocDataUrls++;
    } else if (parsed.isLocalDoc) {
      socDocLocalPaths++;
      socDocObjects.push({
        sourceTable: 'SocietyDocument',
        recordId: sd.id,
        type: sd.type,
        fileName: sd.fileName,
        bucket: parsed.bucket,
        key: parsed.key,
        rawUrl: sd.fileUrl,
        isLocalDoc: true,
      });
    } else {
      socDocObjects.push({
        sourceTable: 'SocietyDocument',
        recordId: sd.id,
        type: sd.type,
        fileName: sd.fileName,
        bucket: parsed.bucket,
        key: parsed.key,
        rawUrl: sd.fileUrl,
        isLocalDoc: false,
      });
    }
  }

  console.log(`\nSocietyDocument: ${socDocs.length} rows`);
  console.log(`  - Local / mock file paths (/documents/...): ${socDocLocalPaths}`);
  console.log(`  - Storage objects: ${socDocObjects.filter(o => !o.isLocalDoc).length}`);
  console.log(`  - Data: URLs: ${socDocDataUrls}`);

  // 4. PostgreSQL sequences check
  console.log('\n--- PostgreSQL Sequences ---');
  const seqs = await prisma.$queryRaw`SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public'`;
  console.log('Public sequences in DB:', seqs);

  // 5. Slip numbers analysis
  console.log('\n--- Slip Numbers Analysis ---');
  const allSlipRows = await prisma.receiptNumberReservation.findMany({
    select: { slipNumber: true, status: true, receiptId: true, createdAt: true },
    orderBy: { createdAt: 'asc' }
  });
  console.log(`ReceiptNumberReservation total: ${allSlipRows.length}`);
  const numericParts = allSlipRows
    .map(s => {
      const match = s.slipNumber.match(/PV-SLIP-\d{4}-(\d+)/);
      return match ? parseInt(match[1], 10) : null;
    })
    .filter(n => n !== null);
  if (numericParts.length > 0) {
    console.log(`Numeric 4-digit slip range: min=${Math.min(...numericParts)}, max=${Math.max(...numericParts)}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
