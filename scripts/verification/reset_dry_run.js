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
if (!directUrl) {
  console.error('ERROR: DIRECT_URL not found in .env');
  process.exit(1);
}

const prisma = new PrismaClient({
  datasources: { db: { url: directUrl } },
});

class DryRunRollbackError extends Error {
  constructor(summary) {
    super('DRY_RUN_ROLLBACK: Intentional rollback of dry run transaction.');
    this.name = 'DryRunRollbackError';
    this.summary = summary;
  }
}

async function runDryRun() {
  console.log('================================================================');
  console.log('STEP 3: DRY RUN — TRANSACTIONAL SIMULATION WITH FORCED ROLLBACK');
  console.log('================================================================\n');

  try {
    await prisma.$transaction(
      async (tx) => {
        // 1. Establish super_admin session variables for RLS compliance
        await tx.$executeRaw`
          SELECT set_config('app.current_role', 'super_admin', true),
                 set_config('app.current_admin_id', 'admin-1', true),
                 set_config('app.can_book', 'true', true),
                 set_config('app.can_reserve', 'true', true);
        `;

        // 2. Query LIVE row counts before execution
        console.log('--- 1. Live Row Counts Before Simulation ---');
        const liveCounts = {
          PaymentAllocation: await tx.paymentAllocation.count(),
          ReceiptApprovalIdempotency: await tx.receiptApprovalIdempotency.count(),
          ReceiptNumberReservation: await tx.receiptNumberReservation.count(),
          ReceiptSubmission: await tx.receiptSubmission.count(),
          PaymentRecord: await tx.paymentRecord.count(),
          SocietyDocument: await tx.societyDocument.count(),
          CustomerDocument: await tx.customerDocument.count(),
          CustomerStrike: await tx.customerStrike.count(),
          Reservation: await tx.reservation.count(),
          Booking: await tx.booking.count(),
          PlotStatusHistory: await tx.plotStatusHistory.count(),
          Customer: await tx.customer.count(),
          AuditEntry: await tx.auditEntry.count(),
          PlotTotal: await tx.plot.count(),
          AdminUser: await tx.adminUser.count(),
          Block: await tx.block.count(),
          BlockAssignment: await tx.blockAssignment.count(),
          ContentBlock: await tx.contentBlock.count(),
          Inquiry: await tx.inquiry.count(),
        };

        for (const [tbl, cnt] of Object.entries(liveCounts)) {
          console.log(`  ${tbl.padEnd(30)}: ${cnt}`);
        }

        // Live plot breakdown
        const livePlots = await tx.plot.findMany({
          select: {
            category: true,
            status: true,
            isAdjustment: true,
            currentOwnerId: true,
            lockedBy: true,
          },
        });

        const liveMatrix = {
          amenity: { available: 0, reserved: 0, booked: 0, allotted: 0, disputed: 0, total: 0 },
          adjustment: { available: 0, reserved: 0, booked: 0, allotted: 0, disputed: 0, total: 0 },
          normal: { available: 0, reserved: 0, booked: 0, allotted: 0, disputed: 0, total: 0 },
        };
        let liveOwners = 0;
        let liveLocks = 0;

        for (const p of livePlots) {
          const type = p.category === 'amenity' ? 'amenity' : p.isAdjustment ? 'adjustment' : 'normal';
          if (liveMatrix[type][p.status] !== undefined) liveMatrix[type][p.status]++;
          liveMatrix[type].total++;
          if (p.currentOwnerId) liveOwners++;
          if (p.lockedBy) liveLocks++;
        }

        console.log('\n--- Live Plot Matrix Before Simulation ---');
        console.table(liveMatrix);
        console.log(`  Plots with owner: ${liveOwners}, Plots with lock: ${liveLocks}`);

        // 3. Perform Deletions & Updates (Strict Foreign Key Order)
        console.log('\n--- 2. Executing Scoped Resets Inside Transaction ---');
        const deletedCounts = {};

        // Step 3a: PaymentAllocation
        const delAlloc = await tx.paymentAllocation.deleteMany();
        deletedCounts.PaymentAllocation = delAlloc.count;
        console.log(`  Deleted PaymentAllocation           : ${delAlloc.count} rows`);

        // Step 3b: ReceiptApprovalIdempotency
        const delIdemp = await tx.receiptApprovalIdempotency.deleteMany();
        deletedCounts.ReceiptApprovalIdempotency = delIdemp.count;
        console.log(`  Deleted ReceiptApprovalIdempotency   : ${delIdemp.count} rows`);

        // Step 3c: ReceiptNumberReservation — PER INSTRUCTION: KEEP
        console.log(`  Preserved ReceiptNumberReservation   : ${liveCounts.ReceiptNumberReservation} rows KEPT (0 deleted)`);

        // Step 3d: ReceiptSubmission
        // Break self-referencing replacesReceiptId first
        await tx.receiptSubmission.updateMany({
          where: { replacesReceiptId: { not: null } },
          data: { replacesReceiptId: null },
        });
        const delRcpt = await tx.receiptSubmission.deleteMany();
        deletedCounts.ReceiptSubmission = delRcpt.count;
        console.log(`  Deleted ReceiptSubmission            : ${delRcpt.count} rows`);

        // Step 3e: PaymentRecord
        const delPay = await tx.paymentRecord.deleteMany();
        deletedCounts.PaymentRecord = delPay.count;
        console.log(`  Deleted PaymentRecord                : ${delPay.count} rows`);

        // Step 3f: SocietyDocument
        const delSocDoc = await tx.societyDocument.deleteMany();
        deletedCounts.SocietyDocument = delSocDoc.count;
        console.log(`  Deleted SocietyDocument              : ${delSocDoc.count} rows`);

        // Step 3g: CustomerDocument
        const delCustDoc = await tx.customerDocument.deleteMany();
        deletedCounts.CustomerDocument = delCustDoc.count;
        console.log(`  Deleted CustomerDocument             : ${delCustDoc.count} rows`);

        // Step 3h: CustomerStrike
        const delStrike = await tx.customerStrike.deleteMany();
        deletedCounts.CustomerStrike = delStrike.count;
        console.log(`  Deleted CustomerStrike               : ${delStrike.count} rows`);

        // Step 3i: Reservation
        const delRes = await tx.reservation.deleteMany();
        deletedCounts.Reservation = delRes.count;
        console.log(`  Deleted Reservation                  : ${delRes.count} rows`);

        // Step 3j: Booking
        const delBook = await tx.booking.deleteMany();
        deletedCounts.Booking = delBook.count;
        console.log(`  Deleted Booking                      : ${delBook.count} rows`);

        // Step 3k: PlotStatusHistory
        const delHist = await tx.plotStatusHistory.deleteMany();
        deletedCounts.PlotStatusHistory = delHist.count;
        console.log(`  Deleted PlotStatusHistory            : ${delHist.count} rows`);

        // Step 3l: Reset Normal Plots
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
        console.log(`  Reset Normal Plots                   : ${updatePlots.count} plots updated to available / unowned / unlocked`);

        // Step 3m: Customer
        const delCust = await tx.customer.deleteMany();
        deletedCounts.Customer = delCust.count;
        console.log(`  Deleted Customer                     : ${delCust.count} rows`);

        // Step 3n: Add AuditEntry for the reset
        const auditDetails = `SYSTEM RESET: Cleared member & sales data. Deleted rows: ${JSON.stringify(deletedCounts)}, Normal plots reset: ${updatePlots.count}, Receipt reservations preserved: ${liveCounts.ReceiptNumberReservation}.`;
        const auditNew = await tx.auditEntry.create({
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
              preservedReceiptReservations: liveCounts.ReceiptNumberReservation,
            },
          },
        });
        console.log(`  Created Reset AuditEntry             : id=${auditNew.id}`);

        // 4. Verify post-reset state inside transaction
        console.log('\n--- 3. Verifying Simulated State Inside Transaction ---');
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
          AuditEntry: await tx.auditEntry.count(),
          PlotTotal: await tx.plot.count(),
          AdminUser: await tx.adminUser.count(),
          Block: await tx.block.count(),
          BlockAssignment: await tx.blockAssignment.count(),
          ContentBlock: await tx.contentBlock.count(),
          Inquiry: await tx.inquiry.count(),
        };

        for (const [tbl, cnt] of Object.entries(postCounts)) {
          const expected = ['Customer', 'CustomerStrike', 'Reservation', 'Booking', 'PaymentRecord', 'PaymentAllocation', 'ReceiptSubmission', 'ReceiptApprovalIdempotency', 'CustomerDocument', 'SocietyDocument', 'PlotStatusHistory'].includes(tbl)
            ? ' (Expected: 0)'
            : tbl === 'ReceiptNumberReservation'
            ? ` (Expected: ${liveCounts.ReceiptNumberReservation} KEPT)`
            : tbl === 'AuditEntry'
            ? ` (Expected: ${liveCounts.AuditEntry + 1})`
            : '';
          console.log(`  ${tbl.padEnd(30)}: ${cnt}${expected}`);
        }

        // Verify plots breakdown
        const postPlots = await tx.plot.findMany({
          select: {
            category: true,
            status: true,
            isAdjustment: true,
            currentOwnerId: true,
            lockedBy: true,
          },
        });

        const postMatrix = {
          amenity: { available: 0, reserved: 0, booked: 0, allotted: 0, disputed: 0, total: 0 },
          adjustment: { available: 0, reserved: 0, booked: 0, allotted: 0, disputed: 0, total: 0 },
          normal: { available: 0, reserved: 0, booked: 0, allotted: 0, disputed: 0, total: 0 },
        };
        let postOwners = 0;
        let postLocks = 0;

        for (const p of postPlots) {
          const type = p.category === 'amenity' ? 'amenity' : p.isAdjustment ? 'adjustment' : 'normal';
          if (postMatrix[type][p.status] !== undefined) postMatrix[type][p.status]++;
          postMatrix[type].total++;
          if (p.currentOwnerId) postOwners++;
          if (p.lockedBy) postLocks++;
        }

        console.log('\n--- Simulated Plot Matrix After Reset ---');
        console.table(postMatrix);
        console.log(`  Plots with owner: ${postOwners} (Expected: 0)`);
        console.log(`  Plots with lock : ${postLocks} (Expected: 0)`);

        // Strict assertions
        if (postCounts.Customer !== 0) throw new Error('Assertion failed: Customer is not 0');
        if (postCounts.Booking !== 0) throw new Error('Assertion failed: Booking is not 0');
        if (postCounts.Reservation !== 0) throw new Error('Assertion failed: Reservation is not 0');
        if (postCounts.PaymentRecord !== 0) throw new Error('Assertion failed: PaymentRecord is not 0');
        if (postCounts.PaymentAllocation !== 0) throw new Error('Assertion failed: PaymentAllocation is not 0');
        if (postCounts.ReceiptSubmission !== 0) throw new Error('Assertion failed: ReceiptSubmission is not 0');
        if (postCounts.CustomerDocument !== 0) throw new Error('Assertion failed: CustomerDocument is not 0');
        if (postCounts.SocietyDocument !== 0) throw new Error('Assertion failed: SocietyDocument is not 0');
        if (postCounts.PlotStatusHistory !== 0) throw new Error('Assertion failed: PlotStatusHistory is not 0');
        if (postCounts.ReceiptNumberReservation !== liveCounts.ReceiptNumberReservation) throw new Error('Assertion failed: ReceiptNumberReservation count changed');
        if (postCounts.PlotTotal !== 1673) throw new Error(`Assertion failed: Plot total is ${postCounts.PlotTotal}, expected 1673`);
        if (postMatrix.normal.available !== 1628) throw new Error(`Assertion failed: Normal available plots is ${postMatrix.normal.available}, expected 1628`);
        if (postMatrix.amenity.total !== 43) throw new Error('Assertion failed: Amenity plots changed');
        if (postMatrix.adjustment.total !== 2) throw new Error('Assertion failed: Adjustment plots changed');
        if (postOwners !== 0) throw new Error('Assertion failed: Some plots still have currentOwnerId');
        if (postLocks !== 0) throw new Error('Assertion failed: Some plots still have locks');

        console.log('\n✓ ALL SIMULATION CHECKS PASSED PERFECTLY!');

        // 5. Force ROLLBACK
        throw new DryRunRollbackError({
          liveCounts,
          deletedCounts,
          normalPlotsReset: updatePlots.count,
          preservedReservations: liveCounts.ReceiptNumberReservation,
          postCounts,
          postMatrix,
        });
      },
      {
        maxWait: 20000,
        timeout: 45000,
      }
    );
  } catch (err) {
    if (err instanceof DryRunRollbackError) {
      console.log('\n================================================================');
      console.log('✓ TRANSACTION ROLLED BACK AS DESIGNED. ZERO ROWS WERE MODIFIED.');
      console.log('================================================================\n');
      return err.summary;
    }
    throw err;
  }
}

runDryRun()
  .then((summary) => {
    // Save dry run output to a file in the backup directory
    const reportPath = path.join('E:\\prime_view_backups\\reset-backup-20261022', 'DRY_RUN_REPORT.json');
    fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2), 'utf-8');
    console.log(`Saved dry run summary to: ${reportPath}`);
  })
  .catch((err) => {
    console.error('Dry run failed with unexpected error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
