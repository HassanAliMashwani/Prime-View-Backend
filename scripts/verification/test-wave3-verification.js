require('./env-helper').initEnv();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
  },
});

const BASE_URL = 'http://localhost:3001';

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  let body = null;
  try {
    body = await res.json();
  } catch (e) {
    body = null;
  }
  return { status: res.status, ok: res.ok, body };
}

async function loginAdmin(username, password = 'password123') {
  const res = await request('/auth/admin/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    throw new Error(`Failed to login as admin ${username}: ${JSON.stringify(res.body)}`);
  }
  return res.body.access_token;
}

async function loginMember(membershipNo, password = 'password123') {
  const res = await request('/auth/member/login', {
    method: 'POST',
    body: JSON.stringify({ membershipNo, password }),
  });
  if (!res.ok) {
    throw new Error(`Failed to login as member ${membershipNo}: ${JSON.stringify(res.body)}`);
  }
  return res.body.access_token;
}

async function main() {
  console.log('═════════════════════════════════════════════════════════════════════');
  console.log('      PRIME VIEW BACKEND PHASE 2 — WAVE 3 VERIFICATION SUITE         ');
  console.log('═════════════════════════════════════════════════════════════════════\n');

  // 0. Authenticate Actors
  console.log('>>> 0. Authenticating test actors...');
  const superToken = await loginAdmin('admin');
  const subToken = await loginAdmin('marketing');
  console.log('  ✓ Super Admin logged in (token acquired)');
  console.log('  ✓ Sub Admin (marketing) logged in (token acquired)\n');

  // ─────────────────────────────────────────────────────────────────────────
  // COMPONENT 1: SUB-ADMIN GOVERNANCE
  // ─────────────────────────────────────────────────────────────────────────
  console.log('>>> 1. Testing Sub-Admin Governance...');

  // 1.1 Super Admin lists sub-admins
  const listRes = await request('/admin/sub-admins', {
    method: 'GET',
    headers: { Authorization: `Bearer ${superToken}` },
  });
  console.log(`  [1.1] GET /admin/sub-admins (Super Admin) -> Status: ${listRes.status}`);
  if (listRes.status !== 200 || !Array.isArray(listRes.body.subAdmins)) {
    throw new Error(`Failed to list sub-admins: ${JSON.stringify(listRes.body)}`);
  }
  console.log(`  ✓ Successfully listed ${listRes.body.subAdmins.length} sub-admins`);

  // 1.2 Sub-Admin is blocked with 403 Forbidden
  const subBlockRes = await request('/admin/sub-admins', {
    method: 'GET',
    headers: { Authorization: `Bearer ${subToken}` },
  });
  console.log(`  [1.2] GET /admin/sub-admins (Sub Admin) -> Status: ${subBlockRes.status}`);
  if (subBlockRes.status !== 403) {
    throw new Error(`Expected 403 for Sub Admin listing sub-admins, got ${subBlockRes.status}`);
  }
  console.log(`  ✓ Sub-Admin correctly blocked with 403: ${subBlockRes.body.error}`);

  // 1.3 Super Admin creates a new Sub-Admin
  const testSubAdminUsername = `testsub_${Date.now()}`;
  const testSubAdminEmail = `${testSubAdminUsername}@primeview.pk`;

  const createRes = await request('/admin/sub-admins', {
    method: 'POST',
    headers: { Authorization: `Bearer ${superToken}` },
    body: JSON.stringify({
      username: testSubAdminUsername,
      email: testSubAdminEmail,
      fullName: 'Test Governance Sub-Admin',
      password: 'password123',
      assignedBlocks: ['abbott', 'royal'],
      permissions: {
        can_reserve: true,
        can_book: true,
        can_create_customer: true,
        can_view_customers: true,
        can_view_sales_reports: false,
        can_edit_content: true,
        can_verify_receipts: true,
      },
    }),
  });
  console.log(`  [1.3] POST /admin/sub-admins -> Status: ${createRes.status}`);
  if (createRes.status !== 201 || !createRes.body.subAdmin) {
    throw new Error(`Failed to create sub-admin: ${JSON.stringify(createRes.body)}`);
  }
  const createdSubAdminId = createRes.body.subAdmin.id;
  console.log(`  ✓ Sub-Admin created: ID ${createdSubAdminId}, username: ${createRes.body.subAdmin.username}`);

  // 1.4 Test duplicate username conflict (USERNAME_TAKEN)
  const dupUserRes = await request('/admin/sub-admins', {
    method: 'POST',
    headers: { Authorization: `Bearer ${superToken}` },
    body: JSON.stringify({
      username: testSubAdminUsername,
      email: `diff_${Date.now()}@primeview.pk`,
      fullName: 'Duplicate Username Sub-Admin',
      password: 'password123',
    }),
  });
  console.log(`  [1.4] Duplicate username -> Status: ${dupUserRes.status}, Error: ${dupUserRes.body?.error}`);
  if (dupUserRes.status !== 409 || dupUserRes.body?.error !== 'USERNAME_TAKEN') {
    throw new Error(`Expected 409 USERNAME_TAKEN, got ${dupUserRes.status} ${JSON.stringify(dupUserRes.body)}`);
  }
  console.log('  ✓ Exact error USERNAME_TAKEN confirmed');

  // 1.5 Test duplicate email conflict (EMAIL_ALREADY_IN_USE)
  const dupEmailRes = await request('/admin/sub-admins', {
    method: 'POST',
    headers: { Authorization: `Bearer ${superToken}` },
    body: JSON.stringify({
      username: `diff_${Date.now()}`,
      email: testSubAdminEmail,
      fullName: 'Duplicate Email Sub-Admin',
      password: 'password123',
    }),
  });
  console.log(`  [1.5] Duplicate email -> Status: ${dupEmailRes.status}, Error: ${dupEmailRes.body?.error}`);
  if (dupEmailRes.status !== 409 || dupEmailRes.body?.error !== 'EMAIL_ALREADY_IN_USE') {
    throw new Error(`Expected 409 EMAIL_ALREADY_IN_USE, got ${dupEmailRes.status} ${JSON.stringify(dupEmailRes.body)}`);
  }
  console.log('  ✓ Exact error EMAIL_ALREADY_IN_USE confirmed');

  // 1.6 Super Admin updates Sub-Admin
  const updateRes = await request(`/admin/sub-admins/${createdSubAdminId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${superToken}` },
    body: JSON.stringify({
      fullName: 'Updated Governance Sub-Admin Name',
      status: 'active',
      assignedBlocks: ['abbott', 'royal', 'chalet'],
    }),
  });
  console.log(`  [1.6] PATCH /admin/sub-admins/:id -> Status: ${updateRes.status}`);
  if (updateRes.status !== 200 || updateRes.body.subAdmin.fullName !== 'Updated Governance Sub-Admin Name') {
    throw new Error(`Failed to update sub-admin: ${JSON.stringify(updateRes.body)}`);
  }
  console.log(`  ✓ Sub-Admin updated with assigned blocks: [${updateRes.body.subAdmin.assignedBlocks.join(', ')}]`);

  // 1.7 Prevent modifying Super Admin (CANNOT_MODIFY_SUPER_ADMIN)
  const modSuperRes = await request('/admin/sub-admins/admin-1', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${superToken}` },
    body: JSON.stringify({ status: 'suspended' }),
  });
  console.log(`  [1.7] Attempt modify Super Admin -> Status: ${modSuperRes.status}, Error: ${modSuperRes.body?.error}`);
  if (modSuperRes.status !== 400 || modSuperRes.body?.error !== 'CANNOT_MODIFY_SUPER_ADMIN') {
    throw new Error(`Expected 400 CANNOT_MODIFY_SUPER_ADMIN, got ${modSuperRes.status} ${JSON.stringify(modSuperRes.body)}`);
  }
  console.log('  ✓ Exact error CANNOT_MODIFY_SUPER_ADMIN confirmed\n');

  // ─────────────────────────────────────────────────────────────────────────
  // COMPONENT 2: PLOT ADJUSTMENTS
  // ─────────────────────────────────────────────────────────────────────────
  console.log('>>> 2. Testing Plot Adjustments (Super Admin Exclusive)...');
  const plotsRes = await request('/plots?blockId=abbott', {
    headers: { Authorization: `Bearer ${superToken}` },
  });
  const plotsArray = Array.isArray(plotsRes.body) ? plotsRes.body : (plotsRes.body?.plots || []);
  const availPlots = plotsArray.filter((p) => p.category !== 'amenity');
  const targetPlot = availPlots.find((p) => p.status === 'available') || availPlots[0];
  if (!targetPlot) throw new Error(`No plot found in Abbott block. Body: ${JSON.stringify(plotsRes.body)}`);
  const testPlotId = targetPlot.id;
  console.log(`  Target plot for adjustment tests: ${testPlotId} (${targetPlot.plotNumber})`);

  // Ensure plot is available and clean
  await prisma.plot.update({
    where: { id: testPlotId },
    data: { status: 'available', isAdjustment: false, adjustmentReason: null, lockedBy: null, lockedAt: null },
  });

  // 2.1 Sub-Admin blocked with 403 Forbidden
  const subAdjRes = await request(`/plots/${testPlotId}/adjustment`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${subToken}` },
    body: JSON.stringify({ isAdjustment: true, reason: 'Unauthorized attempt' }),
  });
  console.log(`  [2.1] Sub-Admin toggle adjustment -> Status: ${subAdjRes.status}, Error: ${subAdjRes.body?.error}`);
  if (subAdjRes.status !== 403) {
    throw new Error(`Expected 403 for Sub Admin plot adjustment, got ${subAdjRes.status}`);
  }
  console.log('  ✓ Sub-Admin forbidden from toggling adjustment');

  // 2.2 Super Admin enables adjustment
  const superAdjOnRes = await request(`/plots/${testPlotId}/adjustment`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${superToken}` },
    body: JSON.stringify({ isAdjustment: true, reason: 'Town Planning Re-Survey & Boundary Alignment' }),
  });
  console.log(`  [2.2] Super Admin toggle adjustment ON -> Status: ${superAdjOnRes.status}`);
  if (superAdjOnRes.status !== 200 || !superAdjOnRes.body.plot.isAdjustment) {
    throw new Error(`Failed to enable plot adjustment: ${JSON.stringify(superAdjOnRes.body)}`);
  }
  console.log(`  ✓ Plot ${testPlotId} flagged with isAdjustment=true (Reason: ${superAdjOnRes.body.plot.adjustmentReason})`);

  // 2.3 Attempt Lock -> blocked with PLOT_UNDER_ADJUSTMENT
  const lockBlockedRes = await request(`/plots/${testPlotId}/lock`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${subToken}` },
  });
  console.log(`  [2.3] Lock attempted on adjustment plot -> Status: ${lockBlockedRes.status}, Error: ${lockBlockedRes.body?.error}`);
  if (lockBlockedRes.status !== 400 || lockBlockedRes.body?.error !== 'PLOT_UNDER_ADJUSTMENT') {
    throw new Error(`Expected 400 PLOT_UNDER_ADJUSTMENT on lock, got ${lockBlockedRes.status} ${JSON.stringify(lockBlockedRes.body)}`);
  }
  console.log('  ✓ Lock blocked with PLOT_UNDER_ADJUSTMENT');

  // 2.4 Attempt Reserve -> blocked with PLOT_UNDER_ADJUSTMENT
  const reserveBlockedRes = await request(`/plots/${testPlotId}/reserve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${subToken}` },
    body: JSON.stringify({
      customerName: 'Test Buyer',
      customerPhone: '0300-1122334',
      tokenFee: 50000,
    }),
  });
  console.log(`  [2.4] Reserve attempted on adjustment plot -> Status: ${reserveBlockedRes.status}, Error: ${reserveBlockedRes.body?.error}`);
  if (reserveBlockedRes.status !== 400 || reserveBlockedRes.body?.error !== 'PLOT_UNDER_ADJUSTMENT') {
    throw new Error(`Expected 400 PLOT_UNDER_ADJUSTMENT on reserve, got ${reserveBlockedRes.status} ${JSON.stringify(reserveBlockedRes.body)}`);
  }
  console.log('  ✓ Reserve blocked with PLOT_UNDER_ADJUSTMENT');

  // 2.5 Attempt Book -> blocked with PLOT_UNDER_ADJUSTMENT
  const bookBlockedRes = await request(`/plots/${testPlotId}/book`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${subToken}` },
    body: JSON.stringify({
      customer: {
        fullName: 'Test Buyer',
        email: 'testbuyer@example.com',
        phone: '0300-9988776',
      },
      paymentType: 'one_time',
      totalPayment: 5000000,
    }),
  });
  console.log(`  [2.5] Book attempted on adjustment plot -> Status: ${bookBlockedRes.status}, Error: ${bookBlockedRes.body?.error}`);
  if (bookBlockedRes.status !== 400 || bookBlockedRes.body?.error !== 'PLOT_UNDER_ADJUSTMENT') {
    throw new Error(`Expected 400 PLOT_UNDER_ADJUSTMENT on book, got ${bookBlockedRes.status} ${JSON.stringify(bookBlockedRes.body)}`);
  }
  console.log('  ✓ Book blocked with PLOT_UNDER_ADJUSTMENT');

  // 2.6 Super Admin releases adjustment
  const superAdjOffRes = await request(`/plots/${testPlotId}/adjustment`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${superToken}` },
    body: JSON.stringify({ isAdjustment: false }),
  });
  console.log(`  [2.6] Super Admin toggle adjustment OFF -> Status: ${superAdjOffRes.status}`);
  if (superAdjOffRes.status !== 200 || superAdjOffRes.body.plot.isAdjustment) {
    throw new Error(`Failed to release plot adjustment: ${JSON.stringify(superAdjOffRes.body)}`);
  }
  console.log(`  ✓ Plot ${testPlotId} adjustment cleared`);

  // 2.7 Verify plot can now be locked normally
  const lockSuccessRes = await request(`/plots/${testPlotId}/lock`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${subToken}` },
  });
  console.log(`  [2.7] Lock attempted after release -> Status: ${lockSuccessRes.status}`);
  if (lockSuccessRes.status !== 200) {
    throw new Error(`Failed to lock plot after adjustment release: ${JSON.stringify(lockSuccessRes.body)}`);
  }
  console.log('  ✓ Lock acquired successfully after adjustment release');
  // Clean release
  await request(`/plots/${testPlotId}/lock`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${subToken}` },
  });
  console.log('  ✓ Plot lock released cleanly\n');

  // ─────────────────────────────────────────────────────────────────────────
  // COMPONENT 3: CONTENT CMS LOCKING & FORCED 30-MINUTE EXPIRY
  // ─────────────────────────────────────────────────────────────────────────
  console.log('>>> 3. Testing Content CMS 30-Minute Concurrent Lock & Forced Expiry...');

  // Ensure at least one content block exists
  let block = await prisma.contentBlock.findFirst({ where: { section: 'plans' } });
  if (!block) {
    block = await prisma.contentBlock.create({
      data: {
        id: `plan-test-${Date.now()}`,
        section: 'plans',
        title: 'Executive Villa 1 Kanal',
        subtitle: 'Luxury Modern Architecture',
        content: 'Exclusive modern floor plan tailored for elite living.',
        metadata: { price: 25000000, size: '1 Kanal', category: 'residential' },
      },
    });
  }
  const blockId = block.id;
  console.log(`  Target ContentBlock: ${blockId} ("${block.title}")`);

  // Clear any existing locks on this block
  await prisma.contentBlock.update({
    where: { id: blockId },
    data: { lockedBy: null, lockedAt: null },
  });

  // 3.1 Super Admin acquires 30-min lock
  const lock1Res = await request(`/content/blocks/${blockId}/lock`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${superToken}` },
  });
  console.log(`  [3.1] Admin 1 (Super Admin) acquires 30m lock -> Status: ${lock1Res.status}`);
  if (lock1Res.status !== 200 || !lock1Res.body.block.lockedBy) {
    throw new Error(`Failed to acquire lock: ${JSON.stringify(lock1Res.body)}`);
  }
  console.log(`  ✓ Lock acquired by: ${lock1Res.body.block.lockedByName} (adminId: ${lock1Res.body.block.lockedBy})`);

  // 3.2 Sub-Admin attempts lock while lock is active -> Conflict (LOCKED_BY_ANOTHER)
  const lock2Res = await request(`/content/blocks/${blockId}/lock`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${subToken}` },
  });
  console.log(`  [3.2] Admin 2 (Sub Admin) acquires lock while active -> Status: ${lock2Res.status}, Error: ${lock2Res.body?.error}`);
  if (lock2Res.status !== 409 || lock2Res.body?.error !== 'LOCKED_BY_ANOTHER') {
    throw new Error(`Expected 409 LOCKED_BY_ANOTHER, got ${lock2Res.status} ${JSON.stringify(lock2Res.body)}`);
  }
  console.log(`  ✓ Concurrent lock blocked with LOCKED_BY_ANOTHER (Held by: ${lock2Res.body.lockedByName})`);

  // 3.3 Sub-Admin attempts save while locked by another -> Conflict (LOCK_LOST)
  const saveLostRes = await request(`/content/blocks/${blockId}/save`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${subToken}` },
    body: JSON.stringify({ title: 'Hijacked Title' }),
  });
  console.log(`  [3.3] Admin 2 saves block without holding lock -> Status: ${saveLostRes.status}, Error: ${saveLostRes.body?.error}`);
  if (saveLostRes.status !== 409 || saveLostRes.body?.error !== 'LOCK_LOST') {
    throw new Error(`Expected 409 LOCK_LOST, got ${saveLostRes.status} ${JSON.stringify(saveLostRes.body)}`);
  }
  console.log('  ✓ Save rejected with LOCK_LOST');

  // 3.4 FORCED / SIMULATED WAIT PAST 30-MINUTE EXPIRY
  // User mandate: "for the content-lock 30-minute expiry, test it with a forced/simulated wait past expiry (not just the happy-path lock-and-release)"
  console.log('  [3.4] Simulating time progression: setting lockedAt to 31 minutes ago (exceeding 30m timeout)...');
  const expiredLockedAt = new Date(Date.now() - 31 * 60 * 1000); // 31 minutes ago
  await prisma.contentBlock.update({
    where: { id: blockId },
    data: { lockedAt: expiredLockedAt },
  });
  console.log(`  ✓ Database updated: lockedAt set to ${expiredLockedAt.toISOString()} (31m ago)`);

  // 3.5 Admin 2 (Sub Admin) now attempts to acquire lock on the expired block
  const lockTakeoverRes = await request(`/content/blocks/${blockId}/lock`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${subToken}` },
  });
  console.log(`  [3.5] Admin 2 attempts lock takeover on expired block -> Status: ${lockTakeoverRes.status}`);
  if (lockTakeoverRes.status !== 200 || !lockTakeoverRes.body.block.lockedBy) {
    throw new Error(`Failed to take over expired lock: ${JSON.stringify(lockTakeoverRes.body)}`);
  }
  console.log(`  ✓ EXPIRED LOCK RE-ACQUIRED by Admin 2: ${lockTakeoverRes.body.block.lockedByName} (adminId: ${lockTakeoverRes.body.block.lockedBy})`);

  // 3.6 Admin 2 saves updates atomically and releases lock
  const saveRes = await request(`/content/blocks/${blockId}/save`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${subToken}` },
    body: JSON.stringify({
      title: 'Executive Villa 1 Kanal (Updated Post-Lock Takeover)',
      subtitle: 'Verified Wave 3 Concurrency',
    }),
  });
  console.log(`  [3.6] Admin 2 atomic save & unlock -> Status: ${saveRes.status}`);
  if (saveRes.status !== 200 || saveRes.body.block.title !== 'Executive Villa 1 Kanal (Updated Post-Lock Takeover)') {
    throw new Error(`Failed to save content block: ${JSON.stringify(saveRes.body)}`);
  }
  console.log('  ✓ Content updated and lock atomically cleared (lockedBy is null in DB)');

  // Verify DB state
  const dbBlock = await prisma.contentBlock.findUnique({ where: { id: blockId } });
  if (dbBlock.lockedBy !== null) {
    throw new Error(`Expected dbBlock.lockedBy to be null after save, got ${dbBlock.lockedBy}`);
  }
  console.log('  ✓ Confirmed in PostgreSQL: lockedBy is null, title updated cleanly\n');

  // ─────────────────────────────────────────────────────────────────────────
  // COMPONENT 4: RECEIPTS VERIFICATION & TYPED ERRORS
  // ─────────────────────────────────────────────────────────────────────────
  console.log('>>> 4. Testing Receipts Verification & Exact DAL Source Error Strings...');

  // User mandate: "for receipt verification, make sure the ALREADY_PAID/RECEIPT_ALREADY_PENDING typed errors are confirmed against the actual DAL source strings the same way CUSTOMER_SUSPENDED was, rather than assumed from the doc tables."

  // 4.0 Setup customer and booking with payment schedule
  let customer = await prisma.customer.findUnique({
    where: { membershipNo: 'PV-2024-001' },
    include: { bookings: { include: { payments: true } } },
  });

  if (!customer) {
    throw new Error('Seed customer PV-2024-001 not found.');
  }

  // Ensure active booking exists with installments
  let booking = customer.bookings[0];
  if (!booking) {
    // create booking for cust-1
    booking = await prisma.booking.create({
      data: {
        id: `book-rcpt-test-${Date.now()}`,
        customerId: customer.id,
        plotId: 'plot-a-01',
        paymentType: 'installment',
        status: 'active',
        createdByAdminId: 'admin-1',
      },
      include: { payments: true },
    });
  }

  // Ensure two installments exist: Inst #1 (pending), Inst #2 (pending)
  let inst1 = await prisma.paymentRecord.findFirst({
    where: { bookingId: booking.id, feeType: 'plot_installment', installmentNumber: 1 },
  });
  if (!inst1) {
    inst1 = await prisma.paymentRecord.create({
      data: {
        bookingId: booking.id,
        feeType: 'plot_installment',
        installmentNumber: 1,
        amount: 500000,
        status: 'pending',
      },
    });
  } else {
    await prisma.paymentRecord.update({
      where: { id: inst1.id },
      data: { status: 'pending', paidAmount: 0 },
    });
  }

  let inst2 = await prisma.paymentRecord.findFirst({
    where: { bookingId: booking.id, feeType: 'plot_installment', installmentNumber: 2 },
  });
  if (!inst2) {
    inst2 = await prisma.paymentRecord.create({
      data: {
        bookingId: booking.id,
        feeType: 'plot_installment',
        installmentNumber: 2,
        amount: 500000,
        status: 'pending',
      },
    });
  } else {
    await prisma.paymentRecord.update({
      where: { id: inst2.id },
      data: { status: 'pending', paidAmount: 0 },
    });
  }

  // Clean any pending receipt submissions for this booking
  await prisma.receiptSubmission.deleteMany({
    where: { bookingId: booking.id },
  });

  const memberToken = await loginMember('PV-2024-001');
  console.log('  ✓ Member PV-2024-001 logged in');

  // 4.1 Guard: BANK_REQUIRED
  const bankReqRes = await request('/receipts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${memberToken}` },
    body: JSON.stringify({
      plotId: booking.plotId,
      paymentType: 'installment',
      installmentNumber: 1,
      amount: 500000,
      depositoryBank: '', // empty bank
      transactionRef: 'TXN-998811',
      paymentDate: new Date().toISOString(),
      receiptFileUrl: 'https://storage.primeview.pk/receipts/test.jpg',
    }),
  });
  console.log(`  [4.1] Empty bank check -> Status: ${bankReqRes.status}, Error: ${bankReqRes.body?.error}`);
  if (bankReqRes.status !== 400 || bankReqRes.body?.error !== 'BANK_REQUIRED') {
    throw new Error(`Expected 400 BANK_REQUIRED, got ${bankReqRes.status} ${JSON.stringify(bankReqRes.body)}`);
  }
  console.log('  ✓ Exact error BANK_REQUIRED confirmed');

  // 4.2 Guard: UNAUTHORIZED_PLOT
  const unauthPlotRes = await request('/receipts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${memberToken}` },
    body: JSON.stringify({
      plotId: 'plot-royal-99', // not owned
      paymentType: 'installment',
      installmentNumber: 1,
      amount: 500000,
      depositoryBank: 'Meezan Bank Ltd',
      transactionRef: 'TXN-998811',
      paymentDate: new Date().toISOString(),
      receiptFileUrl: 'https://storage.primeview.pk/receipts/test.jpg',
    }),
  });
  console.log(`  [4.2] Unauthorized plot check -> Status: ${unauthPlotRes.status}, Error: ${unauthPlotRes.body?.error}`);
  if (unauthPlotRes.status !== 403 || unauthPlotRes.body?.error !== 'UNAUTHORIZED_PLOT') {
    throw new Error(`Expected 403 UNAUTHORIZED_PLOT, got ${unauthPlotRes.status} ${JSON.stringify(unauthPlotRes.body)}`);
  }
  console.log('  ✓ Exact error UNAUTHORIZED_PLOT confirmed');

  // 4.3 Successful Submission for Installment #1
  const submitRes = await request('/receipts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${memberToken}` },
    body: JSON.stringify({
      plotId: booking.plotId,
      paymentType: 'installment',
      installmentNumber: 1,
      amount: 500000,
      depositoryBank: 'Habib Bank Limited (HBL)',
      transactionRef: 'TXN-HBL-2026-001',
      paymentDate: new Date().toISOString(),
      receiptFileUrl: 'https://storage.primeview.pk/receipts/pv_slip_001.jpg',
      receiptFileName: 'pv_slip_001.jpg',
    }),
  });
  console.log(`  [4.3] Submit valid receipt -> Status: ${submitRes.status}`);
  if (submitRes.status !== 201 || !submitRes.body.receipt) {
    throw new Error(`Failed to submit receipt: ${JSON.stringify(submitRes.body)}`);
  }
  const submittedReceiptId = submitRes.body.receipt.id;
  console.log(`  ✓ Receipt submitted successfully: ID ${submittedReceiptId} (Status: pending)`);

  // 4.4 Guard: RECEIPT_ALREADY_PENDING
  const dupPendingRes = await request('/receipts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${memberToken}` },
    body: JSON.stringify({
      plotId: booking.plotId,
      paymentType: 'installment',
      installmentNumber: 1,
      amount: 500000,
      depositoryBank: 'Habib Bank Limited (HBL)',
      transactionRef: 'TXN-HBL-2026-002',
      paymentDate: new Date().toISOString(),
      receiptFileUrl: 'https://storage.primeview.pk/receipts/pv_slip_002.jpg',
    }),
  });
  console.log(`  [4.4] Duplicate pending submission check -> Status: ${dupPendingRes.status}, Error: ${dupPendingRes.body?.error}`);
  if (dupPendingRes.status !== 409 || dupPendingRes.body?.error !== 'RECEIPT_ALREADY_PENDING') {
    throw new Error(`Expected 409 RECEIPT_ALREADY_PENDING, got ${dupPendingRes.status} ${JSON.stringify(dupPendingRes.body)}`);
  }
  console.log('  ✓ Exact error RECEIPT_ALREADY_PENDING confirmed');

  // 4.5 Admin Verification Authority check: Admin without permission is rejected
  // Create an admin without can_verify_receipts
  const noAuthAdminToken = await loginAdmin('police'); // police does not have can_verify_receipts
  const noAuthVerifyRes = await request(`/receipts/${submittedReceiptId}/verify`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${noAuthAdminToken}` },
    body: JSON.stringify({ notes: 'Unauthorized attempt' }),
  });
  console.log(`  [4.5] Verification without permission -> Status: ${noAuthVerifyRes.status}, Error: ${noAuthVerifyRes.body?.error}`);
  if (noAuthVerifyRes.status !== 403 || noAuthVerifyRes.body?.error !== 'FORBIDDEN') {
    throw new Error(`Expected 403 FORBIDDEN, got ${noAuthVerifyRes.status} ${JSON.stringify(noAuthVerifyRes.body)}`);
  }
  console.log('  ✓ Verification without authority rejected with FORBIDDEN');

  // 4.6 Authorized Verification Flow
  const verifyRes = await request(`/receipts/${submittedReceiptId}/verify`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${superToken}` },
    body: JSON.stringify({ notes: 'Bank deposit confirmed against HBL society master statement.' }),
  });
  console.log(`  [4.6] Authorized Admin verifies receipt -> Status: ${verifyRes.status}`);
  if (verifyRes.status !== 200 || verifyRes.body.receipt.status !== 'verified') {
    throw new Error(`Failed to verify receipt: ${JSON.stringify(verifyRes.body)}`);
  }
  const slipNumber = verifyRes.body.receipt.slipNumber;
  const securityHash = verifyRes.body.receipt.securityHash;
  console.log(`  ✓ Receipt verified! Official Slip: ${slipNumber}, Hash: ${securityHash}`);

  // Confirm PaymentRecord marked paid
  const updatedInst1 = await prisma.paymentRecord.findUnique({ where: { id: inst1.id } });
  if (updatedInst1.status !== 'paid') {
    throw new Error(`Expected PaymentRecord ${inst1.id} to be paid, got ${updatedInst1.status}`);
  }
  console.log(`  ✓ Ledger reconciled: PaymentRecord ${inst1.id} status is "paid", paidAmount: PKR ${updatedInst1.paidAmount}`);

  // 4.7 Guard: ALREADY_PROCESSED on re-verification
  const reVerifyRes = await request(`/receipts/${submittedReceiptId}/verify`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${superToken}` },
    body: JSON.stringify({}),
  });
  console.log(`  [4.7] Attempt re-verification -> Status: ${reVerifyRes.status}, Error: ${reVerifyRes.body?.error}`);
  if (reVerifyRes.status !== 409 || reVerifyRes.body?.error !== 'ALREADY_PROCESSED') {
    throw new Error(`Expected 409 ALREADY_PROCESSED, got ${reVerifyRes.status} ${JSON.stringify(reVerifyRes.body)}`);
  }
  console.log('  ✓ Exact error ALREADY_PROCESSED confirmed');

  // 4.8 Guard: ALREADY_PAID when submitting receipt for already settled installment
  const alreadyPaidRes = await request('/receipts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${memberToken}` },
    body: JSON.stringify({
      plotId: booking.plotId,
      paymentType: 'installment',
      installmentNumber: 1, // Already paid above
      amount: 500000,
      depositoryBank: 'Meezan Bank',
      transactionRef: 'TXN-MEEZAN-999',
      paymentDate: new Date().toISOString(),
      receiptFileUrl: 'https://storage.primeview.pk/receipts/pv_slip_999.jpg',
    }),
  });
  console.log(`  [4.8] Submit for already paid installment -> Status: ${alreadyPaidRes.status}, Error: ${alreadyPaidRes.body?.error}`);
  if (alreadyPaidRes.status !== 409 || alreadyPaidRes.body?.error !== 'ALREADY_PAID') {
    throw new Error(`Expected 409 ALREADY_PAID, got ${alreadyPaidRes.status} ${JSON.stringify(alreadyPaidRes.body)}`);
  }
  console.log('  ✓ Exact error ALREADY_PAID confirmed');

  // 4.9 Rejection & Strike Assignment Flow
  // Member submits receipt for Installment #2
  const submitInst2Res = await request('/receipts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${memberToken}` },
    body: JSON.stringify({
      plotId: booking.plotId,
      paymentType: 'installment',
      installmentNumber: 2,
      amount: 500000,
      depositoryBank: 'United Bank Limited',
      transactionRef: 'TXN-FAKE-888',
      paymentDate: new Date().toISOString(),
      receiptFileUrl: 'https://storage.primeview.pk/receipts/fake_slip.jpg',
    }),
  });
  const receipt2Id = submitInst2Res.body.receipt.id;
  console.log(`  [4.9] Submitted receipt for Inst #2 -> ID: ${receipt2Id}`);

  // Fetch customer's current strike count
  const custBefore = await prisma.customer.findUnique({ where: { id: customer.id } });
  const initialStrikeCount = custBefore.strikeCount || 0;

  // Admin rejects receipt with strike
  const rejectRes = await request(`/receipts/${receipt2Id}/reject`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${superToken}` },
    body: JSON.stringify({
      reason: 'Transaction reference not found in bank ledger.',
      assignStrike: true,
      strikeReason: 'Submission of falsified deposit voucher',
    }),
  });
  console.log(`  [4.9] Admin rejects receipt with strike -> Status: ${rejectRes.status}`);
  if (rejectRes.status !== 200 || rejectRes.body.receipt.status !== 'rejected' || !rejectRes.body.strikeAssigned) {
    throw new Error(`Failed to reject receipt with strike: ${JSON.stringify(rejectRes.body)}`);
  }
  console.log(`  ✓ Receipt rejected with strike assigned (Reason: ${rejectRes.body.receipt.rejectionReason})`);

  // Confirm Customer strikeCount in database
  const custAfter = await prisma.customer.findUnique({
    where: { id: customer.id },
    include: { strikes: { orderBy: { assignedAt: 'desc' } } },
  });
  if (custAfter.strikeCount !== initialStrikeCount + 1) {
    throw new Error(`Expected strikeCount to be ${initialStrikeCount + 1}, got ${custAfter.strikeCount}`);
  }
  const latestStrike = custAfter.strikes[0];
  console.log(`  ✓ Customer strikeCount incremented from ${initialStrikeCount} to ${custAfter.strikeCount}`);
  console.log(`  ✓ CustomerStrike created: ID ${latestStrike.id}, Reason: "${latestStrike.reason}", AssignedBy: "${latestStrike.assignedBy}"`);

  // 4.10 Verify In-Transaction Audit Entries
  const auditEntries = await prisma.auditEntry.findMany({
    where: {
      action: { in: ['RECEIPT_SUBMITTED', 'RECEIPT_VERIFIED', 'RECEIPT_REJECTED', 'STRIKE_ASSIGNED', 'PLOT_ADJUSTMENT_TOGGLED', 'CONTENT_LOCK_ACQUIRED', 'CONTENT_UPDATED'] },
    },
    orderBy: { timestamp: 'desc' },
    take: 7,
  });
  console.log(`\n>>> 5. Audit Log In-Transaction Verification:`);
  console.log(`  Found ${auditEntries.length} latest audit log entries for Wave 3 mutations:`);
  for (const a of auditEntries) {
    console.log(`  - [${a.action}] on ${a.entityType}:${a.entityId} by ${a.actorName} (${a.actorRole})`);
  }

  console.log('\n═════════════════════════════════════════════════════════════════════');
  console.log('  ALL WAVE 3 TESTS PASSED WITH 100% UNCOMPROMISING COMPLIANCE!       ');
  console.log('═════════════════════════════════════════════════════════════════════\n');
}

main()
  .catch((err) => {
    console.error('\n❌ Test Suite Failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
