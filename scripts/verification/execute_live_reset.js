const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { PrismaClient } = require('@prisma/client');

const BACKUP_DIR = 'E:\\prime_view_backups\\reset-backup-20261022';

// STRICT EXPECTED COUNTS (from Step 3 Dry Run)
const EXPECTED_COUNTS = {
  PaymentAllocation: 26,
  ReceiptApprovalIdempotency: 24,
  ReceiptNumberReservation: 25,
  ReceiptSubmission: 29,
  PaymentRecord: 187,
  SocietyDocument: 67,
  CustomerDocument: 7,
  CustomerStrike: 7,
  Reservation: 11,
  Booking: 23,
  PlotStatusHistory: 331,
  Customer: 16,
  PlotTotal: 1673,
};

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
if (!directUrl) {
  console.error('ERROR: DIRECT_URL not found in .env');
  process.exit(1);
}

const prisma = new PrismaClient({
  datasources: { db: { url: directUrl } },
});

function sanitizeUrlForPgDump(rawUrl) {
  const parsed = new URL(rawUrl);
  const allowed = ['sslmode', 'sslrootcert', 'sslcert', 'sslkey'];
  const newParams = new URLSearchParams();
  for (const [k, v] of parsed.searchParams.entries()) {
    if (allowed.includes(k.toLowerCase())) {
      newParams.set(k, v);
    }
  }
  if (!newParams.has('sslmode')) {
    newParams.set('sslmode', 'require');
  }
  parsed.search = newParams.toString();
  return parsed.toString();
}

async function runPgDump(dumpFilePath) {
  return new Promise((resolve, reject) => {
    const pgDumpPath = 'C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe';
    if (!fs.existsSync(pgDumpPath)) {
      return reject(new Error(`pg_dump not found at ${pgDumpPath}`));
    }
    console.log(`Starting fresh pg_dump to ${dumpFilePath}...`);
    const dumpUrl = sanitizeUrlForPgDump(directUrl);
    const args = [
      '--dbname=' + dumpUrl,
      '--format=plain',
      '--clean',
      '--if-exists',
      '--no-owner',
      '--no-privileges',
      `--file=${dumpFilePath}`,
    ];
    const child = spawn(pgDumpPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_dump failed with code ${code}: ${stderr.replace(/postgres:\/\/[^@]+@/g, 'postgres://***:***@')}`));
    });
    child.on('error', (err) => reject(err));
  });
}

async function verifyLiveCountsMatchExpected() {
  console.log('--- Verifying Live Counts Match Dry Run Baseline ---');
  const live = {
    PaymentAllocation: await prisma.paymentAllocation.count(),
    ReceiptApprovalIdempotency: await prisma.receiptApprovalIdempotency.count(),
    ReceiptNumberReservation: await prisma.receiptNumberReservation.count(),
    ReceiptSubmission: await prisma.receiptSubmission.count(),
    PaymentRecord: await prisma.paymentRecord.count(),
    SocietyDocument: await prisma.societyDocument.count(),
    CustomerDocument: await prisma.customerDocument.count(),
    CustomerStrike: await prisma.customerStrike.count(),
    Reservation: await prisma.reservation.count(),
    Booking: await prisma.booking.count(),
    PlotStatusHistory: await prisma.plotStatusHistory.count(),
    Customer: await prisma.customer.count(),
    PlotTotal: await prisma.plot.count(),
  };

  const discrepancies = [];
  for (const [table, expected] of Object.entries(EXPECTED_COUNTS)) {
    const actual = live[table];
    if (actual !== expected) {
      discrepancies.push(`${table}: expected ${expected}, found ${actual}`);
    }
  }

  if (discrepancies.length > 0) {
    throw new Error(`SAFETY ABORT: Live database counts changed since dry run!\n${discrepancies.join('\n')}\nAborting execution to prevent inconsistent data loss.`);
  }

  console.log('✓ All live counts strictly match dry run baseline. Proceeding is safe.');
  return live;
}

async function executeReset() {
  console.log('================================================================');
  console.log('STEP 4: LIVE RESET EXECUTION (COMMIT)');
  console.log('================================================================\n');

  // Guard: strictly verify counts before anything
  const liveCounts = await verifyLiveCountsMatchExpected();

  // Guard: Refresh SQL backup immediately before committing real changes
  const freshDumpPath = path.join(BACKUP_DIR, 'full_database_backup_pre_reset_fresh.sql');
  await runPgDump(freshDumpPath);
  console.log(`✓ Fresh SQL backup captured: ${fs.statSync(freshDumpPath).size.toLocaleString()} bytes\n`);

  // Refresh JSON exports
  console.log('--- Refreshing JSON table exports ---');
  const models = [
    'Customer', 'CustomerStrike', 'Reservation', 'Booking', 'PaymentRecord',
    'PaymentAllocation', 'ReceiptSubmission', 'ReceiptNumberReservation',
    'ReceiptApprovalIdempotency', 'CustomerDocument', 'SocietyDocument',
    'PlotStatusHistory', 'AuditEntry'
  ];
  for (const model of models) {
    const delegate = prisma[model.charAt(0).toLowerCase() + model.slice(1)];
    const rows = await delegate.findMany();
    const filePath = path.join(BACKUP_DIR, `${model}.json`);
    fs.writeFileSync(filePath, JSON.stringify(rows, null, 2), 'utf-8');
  }
  const plotRows = await prisma.plot.findMany();
  fs.writeFileSync(path.join(BACKUP_DIR, 'Plot_before_reset.json'), JSON.stringify(plotRows, null, 2), 'utf-8');
  console.log('✓ Scoped tables and plot state JSON refreshed.');

  // Refresh Storage Objects Manifest
  console.log('--- Refreshing Storage Objects Manifest ---');
  const receipts = await prisma.receiptSubmission.findMany({ select: { id: true, slipNumber: true, receiptFileUrl: true } });
  const custDocs = await prisma.customerDocument.findMany({ select: { id: true, customerId: true, type: true, fileName: true, fileUrl: true } });
  const socDocs = await prisma.societyDocument.findMany({ select: { id: true, bookingId: true, customerId: true, type: true, fileName: true, fileUrl: true } });

  const storageObjects = [];
  const skippedDataUrls = [];
  const localDocs = [];

  function parseStorageUrl(rawUrl, defaultBucket = 'receipts') {
    if (!rawUrl) return null;
    const str = String(rawUrl).trim();
    if (str.startsWith('data:')) return { isDataUrl: true, rawPreview: str.slice(0, 40) + '...' };
    if (/^[a-zA-Z0-9_-]+:[^\s/]+/.test(str) && !str.startsWith('http://') && !str.startsWith('https://')) {
      const parts = str.split(':');
      return { bucket: parts[0], key: parts.slice(1).join(':'), isStorageObject: true };
    }
    const match = str.match(/\/storage\/v1\/object\/(?:public|authenticated|sign)\/([a-zA-Z0-9_-]+)\/(.+?)(\?.*)?$/);
    if (match) return { bucket: match[1], key: decodeURIComponent(match[2]), isStorageObject: true };
    if (str.startsWith('/documents/')) return { bucket: 'local-documents', key: str.substring(1), isStorageObject: false, isLocalDoc: true };
    return { bucket: defaultBucket, key: str, isStorageObject: true };
  }

  for (const r of receipts) {
    const p = parseStorageUrl(r.receiptFileUrl, 'receipts');
    if (!p) continue;
    if (p.isDataUrl) skippedDataUrls.push({ table: 'ReceiptSubmission', id: r.id, slipNumber: r.slipNumber });
    else storageObjects.push({ table: 'ReceiptSubmission', id: r.id, slipNumber: r.slipNumber, bucket: p.bucket, key: p.key });
  }

  for (const cd of custDocs) {
    const p = parseStorageUrl(cd.fileUrl, 'customer-documents');
    if (!p) continue;
    if (p.isDataUrl) skippedDataUrls.push({ table: 'CustomerDocument', id: cd.id, type: cd.type, fileName: cd.fileName });
    else storageObjects.push({ table: 'CustomerDocument', id: cd.id, type: cd.type, fileName: cd.fileName, bucket: p.bucket, key: p.key });
  }

  for (const sd of socDocs) {
    const p = parseStorageUrl(sd.fileUrl, 'customer-documents');
    if (!p) continue;
    if (p.isLocalDoc) localDocs.push({ table: 'SocietyDocument', id: sd.id, type: sd.type, fileName: sd.fileName, path: p.key });
    else if (!p.isDataUrl) storageObjects.push({ table: 'SocietyDocument', id: sd.id, type: sd.type, fileName: sd.fileName, bucket: p.bucket, key: p.key });
  }

  const uniqueKeysMap = new Map();
  for (const obj of storageObjects) {
    const compositeKey = `${obj.bucket}:${obj.key}`;
    if (!uniqueKeysMap.has(compositeKey)) uniqueKeysMap.set(compositeKey, obj);
  }
  const uniqueStorageObjects = Array.from(uniqueKeysMap.values());

  const manifest = {
    exportedAt: new Date().toISOString(),
    uniqueStorageObjectsCount: uniqueStorageObjects.length,
    skippedDataUrlsCount: skippedDataUrls.length,
    localDocsCount: localDocs.length,
    uniqueStorageObjects,
    storageObjects,
    skippedDataUrls,
    localDocs,
  };
  fs.writeFileSync(path.join(BACKUP_DIR, 'storage_objects_manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  console.log(`✓ Storage objects manifest refreshed: ${uniqueStorageObjects.length} unique remote objects targeted, ${skippedDataUrls.length} data: URLs skipped.\n`);

  // Execute single atomic transaction
  const result = await prisma.$transaction(
    async (tx) => {
      // 1. Establish super_admin session variables for RLS compliance
      await tx.$executeRaw`
        SELECT set_config('app.current_role', 'super_admin', true),
               set_config('app.current_admin_id', 'admin-1', true),
               set_config('app.can_book', 'true', true),
               set_config('app.can_reserve', 'true', true);
      `;

      const deletedCounts = {};

      // 2a. PaymentAllocation
      const delAlloc = await tx.paymentAllocation.deleteMany();
      deletedCounts.PaymentAllocation = delAlloc.count;

      // 2b. ReceiptApprovalIdempotency
      const delIdemp = await tx.receiptApprovalIdempotency.deleteMany();
      deletedCounts.ReceiptApprovalIdempotency = delIdemp.count;

      // 2c. ReceiptNumberReservation (KEPT)
      // 0 deleted

      // 2d. ReceiptSubmission
      await tx.receiptSubmission.updateMany({
        where: { replacesReceiptId: { not: null } },
        data: { replacesReceiptId: null },
      });
      const delRcpt = await tx.receiptSubmission.deleteMany();
      deletedCounts.ReceiptSubmission = delRcpt.count;

      // 2e. PaymentRecord
      const delPay = await tx.paymentRecord.deleteMany();
      deletedCounts.PaymentRecord = delPay.count;

      // 2f. SocietyDocument
      const delSocDoc = await tx.societyDocument.deleteMany();
      deletedCounts.SocietyDocument = delSocDoc.count;

      // 2g. CustomerDocument
      const delCustDoc = await tx.customerDocument.deleteMany();
      deletedCounts.CustomerDocument = delCustDoc.count;

      // 2h. CustomerStrike
      const delStrike = await tx.customerStrike.deleteMany();
      deletedCounts.CustomerStrike = delStrike.count;

      // 2i. Reservation
      const delRes = await tx.reservation.deleteMany();
      deletedCounts.Reservation = delRes.count;

      // 2j. Booking
      const delBook = await tx.booking.deleteMany();
      deletedCounts.Booking = delBook.count;

      // 2k. PlotStatusHistory
      const delHist = await tx.plotStatusHistory.deleteMany();
      deletedCounts.PlotStatusHistory = delHist.count;

      // 2l. Reset normal plots
      const updatePlots = await tx.plot.updateMany({
        where: {
          category: { not: 'amenity' },
          isAdjustment: false,
        },
        data: {
          status: 'available',
          currentOwnerId: null,
          lockedBy: null,
          lockedByName: null,
          lockedAt: null,
          lockReason: null,
        },
      });

      // 2m. Customer
      const delCust = await tx.customer.deleteMany();
      deletedCounts.Customer = delCust.count;

      // 2n. Add AuditEntry
      const auditDetails = `LIVE SYSTEM RESET: Cleared member & sales data. Deleted: ${JSON.stringify(deletedCounts)}, Normal plots reset: ${updatePlots.count}, Receipt reservations preserved: ${EXPECTED_COUNTS.ReceiptNumberReservation}.`;
      const auditEntry = await tx.auditEntry.create({
        data: {
          actorId: 'admin-1',
          actorName: 'Super Admin',
          actorRole: 'super_admin',
          action: 'RESET_MEMBER_AND_SALES_DATA',
          entityType: 'System',
          entityId: 'SYSTEM_RESET',
          details: auditDetails,
          oldValue: liveCounts,
          newValue: {
            deletedCounts,
            normalPlotsReset: updatePlots.count,
            preservedReceiptReservations: EXPECTED_COUNTS.ReceiptNumberReservation,
          },
        },
      });

      // 3. Post-verification inside transaction
      const postCounts = {
        Customer: await tx.customer.count(),
        CustomerStrike: await tx.customerStrike.count(),
        Reservation: await tx.reservation.count(),
        Booking: await tx.booking.count(),
        PaymentRecord: await tx.paymentRecord.count(),
        PaymentAllocation: await tx.paymentAllocation.count(),
        ReceiptSubmission: await tx.receiptSubmission.count(),
        ReceiptNumberReservation: await tx.receiptNumberReservation.count(),
        ReceiptApprovalIdempotency: await tx.receiptApprovalIdempotency.count(),
        CustomerDocument: await tx.customerDocument.count(),
        SocietyDocument: await tx.societyDocument.count(),
        PlotStatusHistory: await tx.plotStatusHistory.count(),
        PlotTotal: await tx.plot.count(),
      };

      if (postCounts.Customer !== 0) throw new Error('Post-check failed: Customer != 0');
      if (postCounts.Booking !== 0) throw new Error('Post-check failed: Booking != 0');
      if (postCounts.Reservation !== 0) throw new Error('Post-check failed: Reservation != 0');
      if (postCounts.PaymentRecord !== 0) throw new Error('Post-check failed: PaymentRecord != 0');
      if (postCounts.PaymentAllocation !== 0) throw new Error('Post-check failed: PaymentAllocation != 0');
      if (postCounts.ReceiptSubmission !== 0) throw new Error('Post-check failed: ReceiptSubmission != 0');
      if (postCounts.CustomerDocument !== 0) throw new Error('Post-check failed: CustomerDocument != 0');
      if (postCounts.SocietyDocument !== 0) throw new Error('Post-check failed: SocietyDocument != 0');
      if (postCounts.PlotStatusHistory !== 0) throw new Error('Post-check failed: PlotStatusHistory != 0');
      if (postCounts.ReceiptNumberReservation !== EXPECTED_COUNTS.ReceiptNumberReservation) {
        throw new Error('Post-check failed: ReceiptNumberReservation changed');
      }
      if (postCounts.PlotTotal !== 1673) throw new Error('Post-check failed: PlotTotal != 1673');

      return {
        deletedCounts,
        normalPlotsReset: updatePlots.count,
        auditEntryId: auditEntry.id,
        postCounts,
      };
    },
    {
      maxWait: 20000,
      timeout: 45000,
    }
  );

  console.log('================================================================');
  console.log('✓ LIVE RESET COMMITTED SUCCESSFULLY!');
  console.log('================================================================');
  console.log('Summary of Committed Changes:');
  console.log(JSON.stringify(result, null, 2));

  return result;
}

if (process.argv.includes('--run')) {
  executeReset()
    .catch((err) => {
      console.error('\nEXECUTION ERROR:', err.message);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
} else {
  console.log('To execute the live reset, call this script with: node scripts/verification/execute_live_reset.js --run');
  prisma.$disconnect();
}
