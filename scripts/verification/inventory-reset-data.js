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

async function main() {
  console.log('=== STEP 1: READ-ONLY INVENTORY (via DIRECT_URL) ===\n');

  // 1. Table row counts
  const scopedTables = [
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
  ];

  const untouchedTables = [
    'AdminUser',
    'BlockAssignment',
    'Block',
    'ContentBlock',
    'Inquiry',
    'AuditEntry',
    'Plot',
  ];

  console.log('--- SCOPED TABLES (TO BE RESET / DELETED) ---');
  for (const model of scopedTables) {
    const delegate = prisma[model.charAt(0).toLowerCase() + model.slice(1)];
    const count = await delegate.count();
    console.log(`${model.padEnd(30)}: ${count}`);
  }

  console.log('\n--- UNTOUCHED / REFERENCE TABLES ---');
  for (const model of untouchedTables) {
    const delegate = prisma[model.charAt(0).toLowerCase() + model.slice(1)];
    const count = await delegate.count();
    console.log(`${model.padEnd(30)}: ${count}`);
  }

  // 2. Plots by status (available, reserved, booked, allotted, disputed), split into amenity, adjustment, normal
  console.log('\n--- PLOTS BY STATUS (amenity, adjustment, normal) ---');
  const allPlots = await prisma.plot.findMany({
    select: {
      id: true,
      category: true,
      status: true,
      isAdjustment: true,
      currentOwnerId: true,
      lockedBy: true,
      lockedByName: true,
      lockedAt: true,
      lockReason: true,
    }
  });

  const matrix = {
    amenity: { available: 0, reserved: 0, booked: 0, allotted: 0, disputed: 0, total: 0 },
    adjustment: { available: 0, reserved: 0, booked: 0, allotted: 0, disputed: 0, total: 0 },
    normal: { available: 0, reserved: 0, booked: 0, allotted: 0, disputed: 0, total: 0 }
  };

  let plotsWithCurrentOwner = 0;
  let plotsWithLockedBy = 0;

  for (const p of allPlots) {
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
    if (p.lockedBy || p.lockedByName || p.lockedAt || p.lockReason) plotsWithLockedBy++;
  }

  console.table(matrix);
  console.log(`Total plots with currentOwnerId != null : ${plotsWithCurrentOwner}`);
  console.log(`Total plots with lock fields != null   : ${plotsWithLockedBy}`);

  // 3. Foreign key constraints in postgres
  console.log('\n--- FOREIGN KEYS IN DATABASE ---');
  const fks = await prisma.$queryRaw`
    SELECT
        tc.table_name, 
        kcu.column_name, 
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name,
        rc.delete_rule,
        rc.update_rule
    FROM 
        information_schema.table_constraints AS tc 
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
        JOIN information_schema.referential_constraints AS rc
          ON rc.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
    ORDER BY tc.table_name, kcu.column_name;
  `;

  for (const fk of fks) {
    console.log(`[FK] ${fk.table_name}.${fk.column_name} -> ${fk.foreign_table_name}.${fk.foreign_column_name} (ON DELETE: ${fk.delete_rule})`);
  }

  // 4. Check for anything else referencing Customer, Booking, Receipt
  console.log('\n--- CHECKING REFERENCES IN OTHER TABLES ---');
  // Check AuditEntry
  const auditEntries = await prisma.auditEntry.findMany({
    select: { entityType: true, entityId: true }
  });
  console.log(`Total AuditEntry rows: ${auditEntries.length}`);
  const auditEntityTypes = {};
  for (const a of auditEntries) {
    auditEntityTypes[a.entityType] = (auditEntityTypes[a.entityType] || 0) + 1;
  }
  console.log('AuditEntry entityTypes:', auditEntityTypes);

  // Check ContentBlock
  const contentBlocks = await prisma.contentBlock.findMany();
  console.log(`Total ContentBlock rows: ${contentBlocks.length}`);
  for (const cb of contentBlocks) {
    const metaStr = JSON.stringify(cb.metadata || {});
    // search for any uuid or mention
    console.log(`  ContentBlock id=${cb.id}, section=${cb.section}, title=${cb.title}`);
  }

  // Check Inquiries
  const inquiryCount = await prisma.inquiry.count();
  console.log(`Total Inquiry rows: ${inquiryCount}`);

  // Check AdminUser
  const adminUsers = await prisma.adminUser.findMany({
    select: { id: true, username: true, email: true, role: true }
  });
  console.log('Admin users count:', adminUsers.length);
  for (const a of adminUsers) {
    console.log(`  Admin: id=${a.id}, username=${a.username}, role=${a.role}`);
  }

  // Check ReceiptNumberReservation and ReceiptApprovalIdempotency
  const rnr = await prisma.receiptNumberReservation.findMany({
    select: { id: true, slipNumber: true, status: true, receiptId: true }
  });
  console.log(`ReceiptNumberReservation sample (total ${rnr.length}):`, rnr.slice(0, 3));

  const rai = await prisma.receiptApprovalIdempotency.findMany({
    select: { id: true, key: true, receiptId: true, status: true }
  });
  console.log(`ReceiptApprovalIdempotency sample (total ${rai.length}):`, rai.slice(0, 3));

  // Check PlotStatusHistory sources & actors
  const psh = await prisma.plotStatusHistory.groupBy({
    by: ['source'],
    _count: { id: true }
  });
  console.log('PlotStatusHistory by source:', psh);
}

main().catch(console.error).finally(() => prisma.$disconnect());
