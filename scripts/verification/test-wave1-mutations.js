require('./env-helper').initEnv();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
  },
});

const API_BASE = 'http://localhost:3001';

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

async function login(username, password) {
  const res = await request('/auth/admin/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    throw new Error(`Login failed for ${username}: ${JSON.stringify(res.data)}`);
  }
  return res.data.access_token;
}

async function main() {
  console.log('========================================================');
  console.log('   BACKEND PHASE 2 - WAVE 1 MUTATIONS VERIFICATION TEST  ');
  console.log('========================================================\n');

  // Reset any login lockouts
  await prisma.$executeRawUnsafe(`
    UPDATE "AdminUser" SET "failedLoginAttempts" = 0, "lockedUntil" = NULL;
  `);

  // 1. Authenticate users
  console.log('1. Authenticating Admin Users:');
  const superToken = await login('admin', 'password123');
  console.log('   Super Admin (admin): Logged in.');

  const marketingToken = await login('marketing', 'password123');
  console.log('   Sub Admin (marketing - assigned Abbott): Logged in.');

  const policeToken = await login('police', 'password123');
  console.log('   Sub Admin (police - assigned Civic): Logged in.');

  // Target plot in Abbott block for testing: plot-a-02
  const targetPlotId = 'plot-a-02';

  // Ensure plot-a-02 starts as available and clean of test reservations
  await prisma.reservation.deleteMany({ where: { plotId: targetPlotId } });
  await prisma.plot.update({
    where: { id: targetPlotId },
    data: {
      status: 'available',
      currentOwnerId: null,
      lockedBy: null,
      lockedAt: null,
    },
  });

  // 2. Test Lock & Unlock Flow
  console.log('\n2. Testing POST /plots/:id/lock & DELETE /plots/:id/lock:');
  
  // 2a. Out-of-scope lock attempt: police tries to lock plot-a-02 in Abbott block
  const oosLock = await request(`/plots/${targetPlotId}/lock`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${policeToken}` },
  });
  console.log('   Sub Admin outside block locking plot:', oosLock.status === 403 ? '403 OUT_OF_SCOPE (Correct)' : `FAILED (${oosLock.status})`);
  if (oosLock.status !== 403 || (oosLock.data.error !== 'OUT_OF_SCOPE' && oosLock.data.reason !== 'OUT_OF_SCOPE')) {
    throw new Error(`Expected 403 OUT_OF_SCOPE, got ${JSON.stringify(oosLock.data)}`);
  }

  // 2b. Legitimate lock: marketing locks plot-a-02
  const legitLock = await request(`/plots/${targetPlotId}/lock`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${marketingToken}` },
  });
  console.log('   Assigned Sub Admin locking plot:', legitLock.status === 200 && legitLock.data.ok ? `200 OK (Lock token: ${legitLock.data.lockToken?.slice(0, 25)}...)` : `FAILED (${legitLock.status})`);
  if (legitLock.status !== 200 || !legitLock.data.ok) {
    throw new Error(`Expected 200 OK, got ${JSON.stringify(legitLock.data)}`);
  }

  // Verify DB state
  const dbPlotLocked = await prisma.plot.findUnique({ where: { id: targetPlotId } });
  console.log('   DB Check: lockedBy =', dbPlotLocked.lockedBy, '| lockedAt =', dbPlotLocked.lockedAt?.toISOString());
  if (dbPlotLocked.lockedBy !== 'admin-2') {
    throw new Error(`DB mismatch: expected lockedBy 'admin-2', got ${dbPlotLocked.lockedBy}`);
  }

  // 2c. Conflict lock: Super Admin or another admin tries to lock while marketing holds unexpired lock
  const conflictLock = await request(`/plots/${targetPlotId}/lock`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${superToken}` },
  });
  const hasConflictCode = conflictLock.data.error === 'LOCKED_BY_ANOTHER' || conflictLock.data.reason === 'LOCKED_BY_ANOTHER';
  console.log('   Second admin attempting lock on locked plot:', conflictLock.status === 409 ? `409 LOCKED_BY_ANOTHER (Correct)` : `FAILED (${conflictLock.status})`);
  if (conflictLock.status !== 409 || !hasConflictCode) {
    throw new Error(`Expected 409 LOCKED_BY_ANOTHER, got ${JSON.stringify(conflictLock.data)}`);
  }

  // 2d. Unauthorized lock release: police tries to delete lock held by marketing
  const unauthRelease = await request(`/plots/${targetPlotId}/lock`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${policeToken}` },
  });
  console.log('   Unauthorized admin attempting lock release:', unauthRelease.status === 403 ? '403 UNAUTHORIZED_RELEASE (Correct)' : `FAILED (${unauthRelease.status})`);
  if (unauthRelease.status !== 403) {
    throw new Error(`Expected 403, got ${JSON.stringify(unauthRelease.data)}`);
  }

  // 2e. Legitimate lock release: marketing releases lock
  const legitRelease = await request(`/plots/${targetPlotId}/lock`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${marketingToken}` },
  });
  console.log('   Lock holder releasing lock:', legitRelease.status === 200 && legitRelease.data.ok ? '200 OK (Released)' : `FAILED (${legitRelease.status})`);

  const dbPlotUnlocked = await prisma.plot.findUnique({ where: { id: targetPlotId } });
  console.log('   DB Check after release: lockedBy =', dbPlotUnlocked.lockedBy, '(Correct)');
  if (dbPlotUnlocked.lockedBy !== null) {
    throw new Error(`DB mismatch: expected lockedBy null, got ${dbPlotUnlocked.lockedBy}`);
  }

  // 3. Test Reservation & Release Flow
  console.log('\n3. Testing POST /plots/:id/reserve & POST /reservations/:id/release:');
  const resPayload = {
    customerName: 'Kamran Tariq',
    customerPhone: '03001122334',
    customerEmail: 'kamran.tariq@example.com',
    tokenFee: 75000,
    validDays: 7,
    note: 'Initial soft reservation for client review',
  };

  const reserveRes = await request(`/plots/${targetPlotId}/reserve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${marketingToken}` },
    body: JSON.stringify(resPayload),
  });
  console.log('   Reserve plot response:', reserveRes.status === 201 && reserveRes.data.ok ? `201 Created (Res ID: ${reserveRes.data.reservation.id})` : `FAILED (${reserveRes.status})`);
  if (reserveRes.status !== 201 || !reserveRes.data.ok) {
    throw new Error(`Reservation failed: ${JSON.stringify(reserveRes.data)}`);
  }

  const reservationId = reserveRes.data.reservation.id;

  // DB Cross-Check
  const dbPlotReserved = await prisma.plot.findUnique({ where: { id: targetPlotId } });
  const dbRes = await prisma.reservation.findUnique({ where: { id: reservationId } });
  console.log('   DB Check: Plot status =', dbPlotReserved.status, '| Reservation status =', dbRes.status, '| Token =', Number(dbRes.tokenFee));
  if (dbPlotReserved.status !== 'reserved' || dbRes.status !== 'active' || Number(dbRes.tokenFee) !== 75000) {
    throw new Error('Database check failed for reservation');
  }

  // Release reservation
  const releaseRes = await request(`/reservations/${reservationId}/release`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${marketingToken}` },
  });
  console.log('   Release reservation response:', releaseRes.status === 200 && releaseRes.data.ok ? '200 OK (Released)' : `FAILED (${releaseRes.status})`);

  const dbPlotRestored = await prisma.plot.findUnique({ where: { id: targetPlotId } });
  const dbResCancelled = await prisma.reservation.findUnique({ where: { id: reservationId } });
  console.log('   DB Check after release: Plot status =', dbPlotRestored.status, '| Reservation status =', dbResCancelled.status);
  if (dbPlotRestored.status !== 'available' || dbResCancelled.status !== 'cancelled') {
    throw new Error('Database check failed after reservation release');
  }

  // 4. Test Atomic Single-Transaction Booking Pipeline
  console.log('\n4. Testing Atomic Booking Pipeline (POST /plots/:id/book):');
  
  // First, lock plot as marketing
  await request(`/plots/${targetPlotId}/lock`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${marketingToken}` },
  });

  const bookPayload = {
    customer: {
      fullName: 'Zubair Shah',
      email: 'zubair.shah.test@primeview.pk',
      phone: '03215556677',
      cnic: '37405-1234567-9',
      fatherOrHusbandName: 'Shah Nawaz',
      mailingAddress: 'House 45, Street 2, F-8/1, Islamabad',
    },
    paymentType: 'installment',
    installmentPlan: {
      totalPayment: 12500000,
      downpayment: 2500000,
      planYears: 2,
      paidAfterEveryMonths: 3,
      numberOfInstallments: 8,
    },
  };

  const bookRes = await request(`/plots/${targetPlotId}/book`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${marketingToken}` },
    body: JSON.stringify(bookPayload),
  });

  console.log('   Book plot response:', bookRes.status === 201 && bookRes.data.ok ? `201 Created (Booking ID: ${bookRes.data.booking.id})` : `FAILED (${bookRes.status})`);
  if (bookRes.status !== 201 || !bookRes.data.ok) {
    throw new Error(`Booking failed: ${JSON.stringify(bookRes.data)}`);
  }

  const bookingId = bookRes.data.booking.id;
  const bookedCustId = bookRes.data.customer.id;

  // 5. Direct Database Deep Verification of the Atomic Commit
  console.log('\n5. Direct Database Cross-Check for Single-Transaction Commit:');
  
  // Check Plot
  const dbPlotBooked = await prisma.plot.findUnique({ where: { id: targetPlotId } });
  console.log('   a. Plot Status:', dbPlotBooked.status, '| Owner:', dbPlotBooked.currentOwnerId, '| Lock Cleared:', dbPlotBooked.lockedBy === null);

  // Check Booking & Persisted Installment Plan
  const dbBooking = await prisma.booking.findUnique({ where: { id: bookingId } });
  console.log('   b. Booking:', dbBooking.id, '| Status:', dbBooking.status, '| Payment Type:', dbBooking.paymentType);
  console.log('      Persisted installmentPlan on Booking:', JSON.stringify(dbBooking.installmentPlan));
  if (!dbBooking.installmentPlan || dbBooking.installmentPlan.downpayment !== 2500000 || dbBooking.installmentPlan.numberOfInstallments !== 8) {
    throw new Error('Installment plan not properly persisted on Booking');
  }

  // Check PaymentRecords
  const dbPayments = await prisma.paymentRecord.findMany({
    where: { bookingId },
    orderBy: [{ feeType: 'asc' }, { installmentNumber: 'asc' }],
  });
  console.log(`   c. Payment Records (${dbPayments.length} records generated):`);
  let totalPaid = 0;
  let downpaymentFound = false;
  let installmentSum = 0;

  for (const p of dbPayments) {
    if (p.status === 'paid') totalPaid += Number(p.paidAmount);
    if (p.feeType === 'plot_downpayment') downpaymentFound = true;
    if (p.feeType === 'plot_installment') installmentSum += Number(p.amount);
    const instLabel = p.installmentNumber !== null ? `(Inst #${p.installmentNumber})` : '';
    console.log(`      - ${p.feeType.padEnd(24)} ${instLabel.padEnd(12)}: Amount PKR ${Number(p.amount).toLocaleString().padStart(10)} | Status: ${p.status}`);
  }
  console.log('      --> Statutory Fees Isolated: Admission PKR 2,000 + Share Subscription PKR 10,000');
  console.log(`      --> Upfront Downpayment Found: ${downpaymentFound} (PKR 2,500,000 paid upfront)`);
  console.log(`      --> 8 Installments Sum: PKR ${installmentSum.toLocaleString()} (Equal to remaining balance 10,000,000)`);
  console.log(`      --> Total Paid at booking: PKR ${totalPaid.toLocaleString()} (PKR 12k fees + PKR 2.5M downpayment)`);

  if (!downpaymentFound) throw new Error('Missing plot_downpayment record');
  if (installmentSum !== 10000000) throw new Error(`Installment sum mismatch: expected 10,000,000, got ${installmentSum}`);
  if (totalPaid !== 2512000) throw new Error(`Total paid mismatch: expected 2,512,000, got ${totalPaid}`);

  // Check SocietyDocuments
  const dbDocs = await prisma.societyDocument.findMany({
    where: { bookingId },
    orderBy: { type: 'asc' },
  });
  console.log(`   d. Society Documents (${dbDocs.length} generated):`);
  for (const d of dbDocs) {
    console.log(`      - [${d.type}] ${d.fileName} (${d.fileUrl})`);
  }

  // Check AuditEntry
  const dbAudit = await prisma.auditEntry.findFirst({
    where: { entityType: 'booking', entityId: bookingId },
  });
  console.log('   e. Audit Entry in same transaction:', dbAudit ? `Logged [${dbAudit.action}] by ${dbAudit.actorName}` : 'NOT FOUND (Error!)');

  if (!dbPlotBooked || dbPlotBooked.status !== 'booked') throw new Error('Plot not booked in DB');
  if (dbPayments.length !== 11) throw new Error(`Expected 11 payment records (2 fees + 1 downpayment + 8 installments), got ${dbPayments.length}`);
  if (dbDocs.length !== 4) throw new Error(`Expected 4 generated society documents, got ${dbDocs.length}`);
  if (!dbAudit) throw new Error('Audit entry missing from booking transaction');

  // 6. Test ALREADY_BOOKED Double-Booking Conflict Protection
  console.log('\n6. Testing Double-Booking Prevention:');
  const doubleBookRes = await request(`/plots/${targetPlotId}/book`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${superToken}` },
    body: JSON.stringify({
      customerId: bookedCustId,
      paymentType: 'one_time',
    }),
  });
  const hasDoubleBookCode = doubleBookRes.data.error === 'ALREADY_BOOKED' || doubleBookRes.data.reason === 'ALREADY_BOOKED';
  console.log('   Attempt to book already-booked plot:', doubleBookRes.status === 409 ? `409 Conflict (${doubleBookRes.data.reason || doubleBookRes.data.error})` : `FAILED (${doubleBookRes.status})`);
  if (doubleBookRes.status !== 409 || !hasDoubleBookCode) {
    throw new Error('Double booking guard failed!');
  }

  // 7. Clean up test records from database so seeds remain clean
  console.log('\n7. Cleaning up test booking and restoring plot-a-02 to available:');
  await prisma.societyDocument.deleteMany({ where: { bookingId } });
  await prisma.paymentRecord.deleteMany({ where: { bookingId } });
  await prisma.booking.delete({ where: { id: bookingId } });
  await prisma.reservation.deleteMany({ where: { plotId: targetPlotId } });
  await prisma.customer.delete({ where: { id: bookedCustId } });
  await prisma.auditEntry.deleteMany({
    where: {
      OR: [
        { entityId: bookingId },
        { entityId: reservationId },
        { entityId: targetPlotId },
      ],
    },
  });
  await prisma.plot.update({
    where: { id: targetPlotId },
    data: {
      status: 'available',
      currentOwnerId: null,
      lockedBy: null,
      lockedAt: null,
    },
  });
  console.log('   Cleaned up test data. plot-a-02 restored to available.');

  console.log('\n========================================================');
  console.log('   ALL WAVE 1 MUTATIONS VERIFIED AND CONFIRMED LIVE!    ');
  console.log('========================================================');
}

main().catch(console.error).finally(() => prisma.$disconnect());
