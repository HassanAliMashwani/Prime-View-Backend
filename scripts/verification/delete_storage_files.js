const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { PrismaClient } = require('@prisma/client');

const BACKUP_DIR = 'E:\\prime_view_backups\\reset-backup-20261022';

function getEnvVar(key) {
  const envContent = fs.readFileSync(path.join(__dirname, '../../.env'), 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith(key + '=')) {
      let val = trimmed.substring(key.length + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.substring(1, val.length - 1);
      }
      return val;
    }
  }
  return null;
}

const directUrl = getEnvVar('DIRECT_URL') || getEnvVar('DATABASE_URL');
const supabaseUrl = getEnvVar('SUPABASE_URL') || 'https://nnuyccntmxhrkbbsnmwn.supabase.co';
const supabaseKey = getEnvVar('SUPABASE_SERVICE_ROLE_KEY') || getEnvVar('SUPABASE_ANON_KEY');

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

const prisma = new PrismaClient({
  datasources: { db: { url: directUrl } },
});

async function deleteStorageObjects() {
  console.log('================================================================');
  console.log('STEP 5: DELETING SCOPED STORAGE OBJECTS');
  console.log('================================================================\n');

  const manifestPath = path.join(BACKUP_DIR, 'storage_objects_manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  const keysToDelete = manifest.uniqueStorageObjects.map((o) => o.key);
  console.log(`Deleting ${keysToDelete.length} files from Supabase bucket 'receipts'...`);

  // Supabase remove takes array of file paths
  const { data, error } = await supabase.storage.from('receipts').remove(keysToDelete);

  if (error) {
    console.error('Supabase batch delete error:', error);
    throw error;
  }

  const deletedKeys = data ? data.map((d) => d.name) : [];
  console.log(`✓ Supabase confirmed removal of ${deletedKeys.length} files.`);

  // Verify deletion by attempting to list or fetch them
  let remainingCount = 0;
  for (const k of keysToDelete) {
    const check = await supabase.storage.from('receipts').list('', { search: k });
    if (check.data && check.data.some((f) => f.name === k)) {
      console.warn(`  Warning: key still found: ${k}`);
      remainingCount++;
    }
  }

  console.log(`\nDeletion Summary:`);
  console.log(`  Targeted : ${keysToDelete.length}`);
  console.log(`  Deleted  : ${keysToDelete.length - remainingCount}`);
  console.log(`  Remaining: ${remainingCount}`);

  fs.writeFileSync(
    path.join(BACKUP_DIR, 'STORAGE_DELETION_RESULT.json'),
    JSON.stringify(
      {
        deletedAt: new Date().toISOString(),
        targetedCount: keysToDelete.length,
        successfullyRemoved: keysToDelete.length - remainingCount,
        remainingCount,
        deletedFiles: keysToDelete,
      },
      null,
      2
    ),
    'utf-8'
  );

  return { targeted: keysToDelete.length, deleted: keysToDelete.length - remainingCount };
}

async function verifyStep6() {
  console.log('\n================================================================');
  console.log('STEP 6: FINAL SYSTEM VERIFICATION');
  console.log('================================================================\n');

  // Scoped tables count
  const counts = {
    Customer: await prisma.customer.count(),
    CustomerStrike: await prisma.customerStrike.count(),
    Reservation: await prisma.reservation.count(),
    Booking: await prisma.booking.count(),
    PaymentRecord: await prisma.paymentRecord.count(),
    PaymentAllocation: await prisma.paymentAllocation.count(),
    ReceiptSubmission: await prisma.receiptSubmission.count(),
    ReceiptNumberReservation: await prisma.receiptNumberReservation.count(),
    ReceiptApprovalIdempotency: await prisma.receiptApprovalIdempotency.count(),
    CustomerDocument: await prisma.customerDocument.count(),
    SocietyDocument: await prisma.societyDocument.count(),
    PlotStatusHistory: await prisma.plotStatusHistory.count(),
  };

  console.log('--- Scoped Tables (Should all be 0, except preserved reservations) ---');
  for (const [tbl, cnt] of Object.entries(counts)) {
    console.log(`  ${tbl.padEnd(30)}: ${cnt}`);
  }

  // Untouched reference tables
  const untouched = {
    AdminUser: await prisma.adminUser.count(),
    Block: await prisma.block.count(),
    BlockAssignment: await prisma.blockAssignment.count(),
    ContentBlock: await prisma.contentBlock.count(),
    Inquiry: await prisma.inquiry.count(),
    AuditEntry: await prisma.auditEntry.count(),
    PlotTotal: await prisma.plot.count(),
  };

  console.log('\n--- Untouched Reference Tables ---');
  for (const [tbl, cnt] of Object.entries(untouched)) {
    console.log(`  ${tbl.padEnd(30)}: ${cnt}`);
  }

  // Plots breakdown
  const plots = await prisma.plot.findMany({
    select: {
      category: true,
      status: true,
      isAdjustment: true,
      currentOwnerId: true,
      lockedBy: true,
    },
  });

  const matrix = {
    amenity: { available: 0, reserved: 0, booked: 0, allotted: 0, disputed: 0, total: 0 },
    adjustment: { available: 0, reserved: 0, booked: 0, allotted: 0, disputed: 0, total: 0 },
    normal: { available: 0, reserved: 0, booked: 0, allotted: 0, disputed: 0, total: 0 },
  };

  let ownerCount = 0;
  let lockCount = 0;

  for (const p of plots) {
    const type = p.category === 'amenity' ? 'amenity' : p.isAdjustment ? 'adjustment' : 'normal';
    if (matrix[type][p.status] !== undefined) matrix[type][p.status]++;
    matrix[type].total++;
    if (p.currentOwnerId) ownerCount++;
    if (p.lockedBy) lockCount++;
  }

  console.log('\n--- Final Plot Breakdown ---');
  console.table(matrix);
  console.log(`  Total Plots with currentOwnerId: ${ownerCount} (must be 0)`);
  console.log(`  Total Plots with lockedBy      : ${lockCount} (must be 0)`);
}

async function main() {
  await deleteStorageObjects();
  await verifyStep6();
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
