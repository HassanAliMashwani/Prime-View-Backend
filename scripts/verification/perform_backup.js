const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { PrismaClient } = require('@prisma/client');

const BACKUP_DIR = 'E:\\prime_view_backups\\reset-backup-20261022';

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

function parseStorageUrl(rawUrl, defaultBucket = 'receipts') {
  if (!rawUrl) return null;
  const str = String(rawUrl).trim();

  if (str.startsWith('data:')) {
    return { isDataUrl: true, rawPreview: str.slice(0, 40) + '...' };
  }

  // Format: "bucket:key"
  if (/^[a-zA-Z0-9_-]+:[^\s/]+/.test(str) && !str.startsWith('http://') && !str.startsWith('https://')) {
    const parts = str.split(':');
    return {
      bucket: parts[0],
      key: parts.slice(1).join(':'),
      isStorageObject: true,
      raw: str,
    };
  }

  // Supabase storage URLs: /storage/v1/object/(public|authenticated|sign)/<bucket>/<key>
  const match = str.match(/\/storage\/v1\/object\/(?:public|authenticated|sign)\/([a-zA-Z0-9_-]+)\/(.+?)(\?.*)?$/);
  if (match) {
    return {
      bucket: match[1],
      key: decodeURIComponent(match[2]),
      isStorageObject: true,
      raw: str,
    };
  }

  // Local document paths
  if (str.startsWith('/documents/')) {
    return {
      bucket: 'local-documents',
      key: str.substring(1),
      isStorageObject: false,
      isLocalDoc: true,
      raw: str,
    };
  }

  return {
    bucket: defaultBucket,
    key: str,
    isStorageObject: true,
    raw: str,
  };
}

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

    console.log(`Starting pg_dump using ${pgDumpPath}...`);
    const dumpUrl = sanitizeUrlForPgDump(directUrl);
    // Pass connection string safely via dbname argument without logging it
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
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        // Redact any possible credentials from error message
        const sanitizedErr = stderr.replace(/postgres:\/\/[^@]+@/g, 'postgres://***:***@');
        reject(new Error(`pg_dump failed with exit code ${code}: ${sanitizedErr}`));
      }
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

async function exportJsonTables() {
  console.log('\n--- Exporting scoped tables to JSON ---');
  const models = [
    'Customer',
    'CustomerStrike',
    'Reservation',
    'Booking',
    'PaymentRecord',
    'PaymentAllocation',
    'ReceiptSubmission',
    'ReceiptNumberReservation',
    'ReceiptApprovalIdempotency',
    'CustomerDocument',
    'SocietyDocument',
    'PlotStatusHistory',
    'AuditEntry',
  ];

  const exportSummary = {};

  for (const model of models) {
    const delegate = prisma[model.charAt(0).toLowerCase() + model.slice(1)];
    const rows = await delegate.findMany();
    const filePath = path.join(BACKUP_DIR, `${model}.json`);
    fs.writeFileSync(filePath, JSON.stringify(rows, null, 2), 'utf-8');
    exportSummary[model] = { count: rows.length, sizeBytes: fs.statSync(filePath).size };
    console.log(`  Exported ${model.padEnd(28)}: ${String(rows.length).padStart(4)} rows (${(exportSummary[model].sizeBytes / 1024).toFixed(1)} KB)`);
  }

  // Also export pre-reset plot state
  const plotRows = await prisma.plot.findMany();
  const plotFilePath = path.join(BACKUP_DIR, `Plot_before_reset.json`);
  fs.writeFileSync(plotFilePath, JSON.stringify(plotRows, null, 2), 'utf-8');
  exportSummary['Plot_before_reset'] = { count: plotRows.length, sizeBytes: fs.statSync(plotFilePath).size };
  console.log(`  Exported Plot_before_reset           : ${String(plotRows.length).padStart(4)} rows (${(exportSummary['Plot_before_reset'].sizeBytes / 1024).toFixed(1)} KB)`);

  return exportSummary;
}

async function exportStorageManifest() {
  console.log('\n--- Building and exporting Storage Objects Manifest ---');
  const receipts = await prisma.receiptSubmission.findMany({
    select: { id: true, slipNumber: true, receiptFileUrl: true },
  });

  const custDocs = await prisma.customerDocument.findMany({
    select: { id: true, customerId: true, type: true, fileName: true, fileUrl: true },
  });

  const socDocs = await prisma.societyDocument.findMany({
    select: { id: true, bookingId: true, customerId: true, type: true, fileName: true, fileUrl: true },
  });

  const storageObjects = [];
  const skippedDataUrls = [];
  const localDocs = [];

  // Receipts
  for (const r of receipts) {
    const parsed = parseStorageUrl(r.receiptFileUrl, 'receipts');
    if (!parsed) continue;
    if (parsed.isDataUrl) {
      skippedDataUrls.push({
        sourceTable: 'ReceiptSubmission',
        recordId: r.id,
        slipNumber: r.slipNumber,
        preview: parsed.rawPreview,
      });
    } else {
      storageObjects.push({
        sourceTable: 'ReceiptSubmission',
        recordId: r.id,
        slipNumber: r.slipNumber,
        bucket: parsed.bucket,
        key: parsed.key,
        rawUrl: r.receiptFileUrl,
      });
    }
  }

  // Customer Documents (CNIC, photos)
  for (const cd of custDocs) {
    const parsed = parseStorageUrl(cd.fileUrl, 'customer-documents');
    if (!parsed) continue;
    if (parsed.isDataUrl) {
      skippedDataUrls.push({
        sourceTable: 'CustomerDocument',
        recordId: cd.id,
        customerId: cd.customerId,
        type: cd.type,
        fileName: cd.fileName,
        preview: parsed.rawPreview,
      });
    } else {
      storageObjects.push({
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

  // Society Documents (system generated mock/local)
  for (const sd of socDocs) {
    const parsed = parseStorageUrl(sd.fileUrl, 'customer-documents');
    if (!parsed) continue;
    if (parsed.isDataUrl) {
      skippedDataUrls.push({
        sourceTable: 'SocietyDocument',
        recordId: sd.id,
        type: sd.type,
        fileName: sd.fileName,
        preview: parsed.rawPreview,
      });
    } else if (parsed.isLocalDoc) {
      localDocs.push({
        sourceTable: 'SocietyDocument',
        recordId: sd.id,
        type: sd.type,
        fileName: sd.fileName,
        path: parsed.key,
        rawUrl: sd.fileUrl,
      });
    } else {
      storageObjects.push({
        sourceTable: 'SocietyDocument',
        recordId: sd.id,
        type: sd.type,
        fileName: sd.fileName,
        bucket: parsed.bucket,
        key: parsed.key,
        rawUrl: sd.fileUrl,
      });
    }
  }

  // Deduplicate unique remote storage keys
  const uniqueKeysMap = new Map();
  for (const obj of storageObjects) {
    const compositeKey = `${obj.bucket}:${obj.key}`;
    if (!uniqueKeysMap.has(compositeKey)) {
      uniqueKeysMap.set(compositeKey, obj);
    }
  }
  const uniqueStorageObjects = Array.from(uniqueKeysMap.values());

  const manifest = {
    exportedAt: new Date().toISOString(),
    totalStorageObjectsToTarget: storageObjects.length,
    uniqueStorageObjectsToTarget: uniqueStorageObjects.length,
    skippedDataUrlsCount: skippedDataUrls.length,
    localDocsCount: localDocs.length,
    uniqueStorageObjects,
    storageObjects,
    skippedDataUrls,
    localDocs,
  };

  const manifestPath = path.join(BACKUP_DIR, 'storage_objects_manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  console.log(`  Manifest saved to: ${manifestPath}`);
  console.log(`  - Unique remote storage objects to delete in Step 5: ${uniqueStorageObjects.length}`);
  console.log(`  - Data: URLs skipped (stored base64, not in bucket) : ${skippedDataUrls.length}`);
  console.log(`  - Local/mock document paths skipped                : ${localDocs.length}`);

  return manifest;
}

async function verifySqlBackup(dumpFilePath) {
  console.log('\n--- Verifying SQL Dump ---');
  const stat = fs.statSync(dumpFilePath);
  console.log(`  SQL Dump File Size: ${(stat.size / 1024).toFixed(1)} KB (${stat.size.toLocaleString()} bytes)`);

  const content = fs.readFileSync(dumpFilePath, 'utf-8');
  const expectedTables = [
    'Customer',
    'CustomerStrike',
    'Reservation',
    'Booking',
    'PaymentRecord',
    'PaymentAllocation',
    'ReceiptSubmission',
    'ReceiptNumberReservation',
    'ReceiptApprovalIdempotency',
    'CustomerDocument',
    'SocietyDocument',
    'PlotStatusHistory',
    'Plot',
    'Block',
    'BlockAssignment',
    'AdminUser',
    'ContentBlock',
    'Inquiry',
    'AuditEntry',
  ];

  const missingTables = [];
  for (const t of expectedTables) {
    const regex = new RegExp(`CREATE TABLE.*"${t}"|COPY.*"${t}"`, 'i');
    if (!regex.test(content)) {
      missingTables.push(t);
    }
  }

  if (missingTables.length > 0) {
    console.warn('  WARNING: Some tables were not explicitly matched by regex:', missingTables);
  } else {
    console.log(`  ✓ All ${expectedTables.length} database tables are present in the SQL dump!`);
  }
}

async function main() {
  console.log('=== STEP 2: BACKUP INITIALIZATION ===');
  console.log(`Backup Destination: ${BACKUP_DIR}`);

  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const dumpFilePath = path.join(BACKUP_DIR, 'full_database_backup.sql');

  // 1. Run pg_dump
  await runPgDump(dumpFilePath);

  // 2. Verify SQL dump
  await verifySqlBackup(dumpFilePath);

  // 3. Export JSON tables
  const jsonSummary = await exportJsonTables();

  // 4. Export storage manifest
  const storageManifest = await exportStorageManifest();

  // 5. Write a master backup manifest
  const backupSummary = {
    backupTimestamp: new Date().toISOString(),
    backupDirectory: BACKUP_DIR,
    sqlDump: {
      fileName: 'full_database_backup.sql',
      sizeBytes: fs.statSync(dumpFilePath).size,
    },
    jsonTables: jsonSummary,
    storage: {
      uniqueObjectsToDelete: storageManifest.uniqueStorageObjectsToTarget,
      dataUrlsSkipped: storageManifest.skippedDataUrlsCount,
    },
  };
  fs.writeFileSync(path.join(BACKUP_DIR, 'BACKUP_MANIFEST.json'), JSON.stringify(backupSummary, null, 2), 'utf-8');

  console.log('\n=== BACKUP COMPLETE AND VERIFIED ===\n');
}

main().catch(console.error).finally(() => prisma.$disconnect());
