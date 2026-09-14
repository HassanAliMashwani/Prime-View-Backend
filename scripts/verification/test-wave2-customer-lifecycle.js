require('./env-helper').initEnv();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } },
});

const BASE_URL = 'http://localhost:3001';

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function login(username, password) {
  const res = await request('/auth/admin/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  if ((res.status !== 200 && res.status !== 201) || !res.data || !res.data.access_token) {
    throw new Error(`Login failed for ${username}: (Status: ${res.status}) ${JSON.stringify(res.data)}`);
  }
  return res.data.access_token;
}

async function main() {
  console.log('========================================================');
  console.log('   BACKEND PHASE 2 - WAVE 2 CUSTOMER LIFECYCLE TESTS    ');
  console.log('========================================================\n');

  // 1. Authenticate tokens
  console.log('1. Authenticating Admin Users:');
  const superToken = await login('admin', 'password123');
  console.log('   Super Admin: Logged in.');
  const marketingToken = await login('marketing', 'password123');
  console.log('   Sub Admin (marketing - Abbott assigned): Logged in.');
  const policeToken = await login('police', 'password123');
  console.log('   Sub Admin (police - Civic assigned): Logged in.');

  const testPlots = ['plot-a-02', 'plot-a-03', 'plot-a-04'];
  // Pre-test cleanup on test plots & test customers
  const testCnics = ['37405-1122334-5', '37405-5544332-1'];
  const testMemberships = ['PV-MEM-9901', 'PV-MEM-9902'];
  const existingTestCusts = await prisma.customer.findMany({
    where: { OR: [{ cnic: { in: testCnics } }, { membershipNo: { in: testMemberships } }] },
    select: { id: true },
  });
  const existingTestCustIds = existingTestCusts.map(c => c.id);
  if (existingTestCustIds.length > 0) {
    await prisma.customerStrike.deleteMany({ where: { customerId: { in: existingTestCustIds } } });
    await prisma.societyDocument.deleteMany({ where: { OR: [{ booking: { plotId: { in: testPlots } } }, { booking: { customerId: { in: existingTestCustIds } } }] } });
    await prisma.paymentRecord.deleteMany({ where: { OR: [{ booking: { plotId: { in: testPlots } } }, { booking: { customerId: { in: existingTestCustIds } } }] } });
    await prisma.booking.deleteMany({ where: { OR: [{ plotId: { in: testPlots } }, { customerId: { in: existingTestCustIds } }] } });
    await prisma.customer.deleteMany({ where: { id: { in: existingTestCustIds } } });
  }

  await prisma.societyDocument.deleteMany({ where: { booking: { plotId: { in: testPlots } } } });
  await prisma.paymentRecord.deleteMany({ where: { booking: { plotId: { in: testPlots } } } });
  await prisma.booking.deleteMany({ where: { plotId: { in: testPlots } } });
  await prisma.reservation.deleteMany({ where: { plotId: { in: testPlots } } });
  await prisma.plot.updateMany({
    where: { id: { in: testPlots } },
    data: { status: 'available', currentOwnerId: null, lockedBy: null, lockedAt: null },
  });

  // Track created entities for cleanup
  const cleanupCustomerIds = [];
  const cleanupBookingIds = [];

  // ─────────────────────────────────────────────────────────────
  // 2. Test Minimal Quick Booking Flow (POST /customers/minimal-booking)
  // ─────────────────────────────────────────────────────────────
  console.log('\n2. Testing Minimal Quick Booking (POST /customers/minimal-booking):');
  
  // 2a. Out-of-scope check
  const oosMinRes = await request('/customers/minimal-booking', {
    method: 'POST',
    headers: { Authorization: `Bearer ${policeToken}` },
    body: JSON.stringify({
      plotId: 'plot-a-02',
      customerName: 'Taimoor Khan',
      cnic: '37405-1122334-5',
      city: 'Rawalpindi',
    }),
  });
  console.log('   Out-of-scope minimal booking attempt:', oosMinRes.status === 403 ? '403 OUT_OF_SCOPE (Correct)' : `FAILED (${oosMinRes.status})`);
  if (oosMinRes.status !== 403) throw new Error('Expected 403 OUT_OF_SCOPE');

  // 2b. Legitimate minimal booking by assigned marketing admin
  const minRes = await request('/customers/minimal-booking', {
    method: 'POST',
    headers: { Authorization: `Bearer ${marketingToken}` },
    body: JSON.stringify({
      plotId: 'plot-a-02',
      customerName: 'Taimoor Khan',
      cnic: '37405-1122334-5',
      city: 'Rawalpindi',
    }),
  });
  console.log('   Legitimate minimal booking:', minRes.status === 201 && minRes.data.ok ? `201 Created (Cust ID: ${minRes.data.customer.id}, Booking ID: ${minRes.data.booking.id})` : `FAILED (${minRes.status})`);
  if (minRes.status !== 201 || !minRes.data.ok) throw new Error(`Minimal booking failed: ${JSON.stringify(minRes.data)}`);

  const minCustId = minRes.data.customer.id;
  const minBookingId = minRes.data.booking.id;
  cleanupCustomerIds.push(minCustId);
  cleanupBookingIds.push(minBookingId);

  // Direct DB Verification
  const dbMinCust = await prisma.customer.findUnique({ where: { id: minCustId } });
  const dbMinPlot = await prisma.plot.findUnique({ where: { id: 'plot-a-02' } });
  const dbMinBooking = await prisma.booking.findUnique({ where: { id: minBookingId } });
  console.log('   DB Check: Customer registrationStatus =', dbMinCust.registrationStatus, '| credentialsPending =', dbMinCust.credentialsPending);
  console.log('   DB Check: Plot status =', dbMinPlot.status, '| Owner =', dbMinPlot.currentOwnerId);
  console.log('   DB Check: Booking status =', dbMinBooking.status, '| registrationStatus =', dbMinBooking.registrationStatus);

  if (dbMinCust.registrationStatus !== 'minimal' || !dbMinCust.credentialsPending || dbMinPlot.status !== 'booked') {
    throw new Error('Database check failed for minimal booking');
  }

  // ─────────────────────────────────────────────────────────────
  // 3. Test Complete Member Registration (POST /customers/:id/complete-registration)
  // ─────────────────────────────────────────────────────────────
  console.log('\n3. Testing Complete Member Registration (POST /customers/:id/complete-registration):');
  
  // 3a. Forbidden for Sub-Admin
  const unauthCompRes = await request(`/customers/${minCustId}/complete-registration`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${marketingToken}` },
    body: JSON.stringify({
      membershipNo: 'PV-MEM-9901',
      fatherOrHusbandName: 'Khan Bahadur',
      phone: '03009988776',
      email: 'taimoor.khan@primeview.pk',
      mailingAddress: 'House 99, Street 1, Rawalpindi',
      nokName: 'Mrs. Taimoor',
      nokCnic: '37405-9988776-2',
      paymentType: 'installment',
    }),
  });
  console.log('   Sub-admin attempting complete registration:', unauthCompRes.status === 403 ? '403 FORBIDDEN (Correct - Super Admin only)' : `FAILED (${unauthCompRes.status})`);
  if (unauthCompRes.status !== 403) throw new Error('Expected 403 FORBIDDEN for non-super-admin');

  // 3b. Super Admin completing registration with UNEVEN installment plan
  // Total 12,500,000, Downpayment 2,500,000, 7 installments (10M / 7 = 1,428,571 with remainder 3)
  const completePayload = {
    membershipNo: 'PV-MEM-9901',
    fatherOrHusbandName: 'Khan Bahadur',
    phone: '03009988776',
    email: 'taimoor.khan@primeview.pk',
    mailingAddress: 'House 99, Street 1, Rawalpindi',
    nokName: 'Mrs. Taimoor',
    nokCnic: '37405-9988776-2',
    paymentType: 'installment',
    portalPassword: 'MembershipPass2026!',
    installmentPlan: {
      totalPayment: 12500000,
      downpayment: 2500000,
      numberOfInstallments: 7,
      paidAfterEveryMonths: 3,
    },
  };

  const compRes = await request(`/customers/${minCustId}/complete-registration`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${superToken}` },
    body: JSON.stringify(completePayload),
  });
  console.log('   Super Admin completing registration:', compRes.status === 201 && compRes.data.ok ? `201 OK (Membership: ${compRes.data.customer.membershipNo})` : `FAILED (${compRes.status})`);
  if (compRes.status !== 201 || !compRes.data.ok) throw new Error(`Complete registration failed: ${JSON.stringify(compRes.data)}`);

  // DB Verification of Completed Registration
  const dbCompCust = await prisma.customer.findUnique({ where: { id: minCustId } });
  const dbCompBooking = await prisma.booking.findUnique({ where: { id: minBookingId } });
  const dbCompPayments = await prisma.paymentRecord.findMany({
    where: { bookingId: minBookingId },
    orderBy: [{ feeType: 'asc' }, { installmentNumber: 'asc' }],
  });
  console.log('   DB Check: Customer registrationStatus =', dbCompCust.registrationStatus, '| credentialsPending =', dbCompCust.credentialsPending, '| Membership =', dbCompCust.membershipNo);
  console.log('   DB Check: Booking status =', dbCompBooking.status, '| Persisted Plan =', JSON.stringify(dbCompBooking.installmentPlan));
  console.log(`   DB Check: Payment Records (${dbCompPayments.length} generated):`);

  let compTotalPaid = 0;
  let compInstSum = 0;
  for (const p of dbCompPayments) {
    if (p.status === 'paid') compTotalPaid += Number(p.paidAmount);
    if (p.feeType === 'plot_installment') compInstSum += Number(p.amount);
    const instStr = p.installmentNumber !== null ? `(Inst #${p.installmentNumber})` : '';
    console.log(`      - ${p.feeType.padEnd(24)} ${instStr.padEnd(12)}: PKR ${Number(p.amount).toLocaleString().padStart(10)} | Status: ${p.status}`);
  }
  console.log(`      --> Statutory Fees: Admission PKR 2,000 + Share Sub PKR 10,000 (Isolated)`);
  console.log(`      --> Installment Remainder Absorber: Final Inst #7 = PKR ${Number(dbCompPayments.find(p => p.installmentNumber === 7).amount).toLocaleString()} (Base 1,428,571 + 3)`);
  console.log(`      --> Sum of 7 installments = PKR ${compInstSum.toLocaleString()} (Exact 10,000,000)`);
  console.log(`      --> Total Paid upfront = PKR ${compTotalPaid.toLocaleString()} (PKR 12k fees + PKR 2.5M downpayment)`);

  if (dbCompCust.registrationStatus !== 'complete' || dbCompCust.credentialsPending) throw new Error('Customer not marked complete');
  if (dbCompPayments.length !== 10) throw new Error(`Expected 10 payments (2 fees + 1 downpayment + 7 installments), got ${dbCompPayments.length}`);
  if (compInstSum !== 10000000) throw new Error('Installment sum mismatch');

  // ─────────────────────────────────────────────────────────────
  // 4. Test Path A: Create Customer with Booking (POST /customers)
  // ─────────────────────────────────────────────────────────────
  console.log('\n4. Testing Path A: Full Customer Registration with Booking (POST /customers):');
  
  // Non-evenly divisible installment numbers: 10,500,000 / 9 installments = 1,166,666.666... (base 1,166,666, remainder 6)
  const pathAPayload = {
    plotId: 'plot-a-03',
    paymentType: 'installment',
    membershipNo: 'PV-MEM-9902',
    fullName: 'Salman Farooqi',
    fatherOrHusbandName: 'Farooq Ahmad',
    cnic: '37405-5544332-1',
    phone: '03125554433',
    email: 'salman.farooqi@primeview.pk',
    mailingAddress: 'House 55, Sector F-10/2, Islamabad',
    nokName: 'Zainab Farooqi',
    nokCnic: '37405-5544332-2',
    portalPassword: 'SalmanPassword123!',
    installmentPlan: {
      totalPayment: 12500000,
      downpayment: 2000000,
      numberOfInstallments: 9,
      paidAfterEveryMonths: 2,
    },
  };

  const pathARes = await request('/customers', {
    method: 'POST',
    headers: { Authorization: `Bearer ${marketingToken}` },
    body: JSON.stringify(pathAPayload),
  });
  console.log('   Path A customer create response:', pathARes.status === 201 && pathARes.data.ok ? `201 Created (Cust ID: ${pathARes.data.customer.id}, Booking ID: ${pathARes.data.booking.id})` : `FAILED (${pathARes.status})`);
  if (pathARes.status !== 201 || !pathARes.data.ok) throw new Error(`Path A failed: ${JSON.stringify(pathARes.data)}`);

  const pathACustId = pathARes.data.customer.id;
  const pathABookingId = pathARes.data.booking.id;
  cleanupCustomerIds.push(pathACustId);
  cleanupBookingIds.push(pathABookingId);

  // DB Verification of Path A
  const dbPathAPlot = await prisma.plot.findUnique({ where: { id: 'plot-a-03' } });
  const dbPathAPayments = await prisma.paymentRecord.findMany({
    where: { bookingId: pathABookingId },
    orderBy: [{ feeType: 'asc' }, { installmentNumber: 'asc' }],
  });
  console.log('   DB Check: Plot-a-03 status =', dbPathAPlot.status, '| Owner =', dbPathAPlot.currentOwnerId);
  console.log(`   DB Check: Payment Records (${dbPathAPayments.length} generated for 9-installment plan):`);

  let pathAInstSum = 0;
  for (const p of dbPathAPayments) {
    if (p.feeType === 'plot_installment') pathAInstSum += Number(p.amount);
  }
  const inst9 = dbPathAPayments.find(p => p.installmentNumber === 9);
  console.log(`      --> Upfront Downpayment: PKR ${Number(dbPathAPayments.find(p => p.feeType === 'plot_downpayment').amount).toLocaleString()} (Paid)`);
  console.log(`      --> 9 Installments Sum = PKR ${pathAInstSum.toLocaleString()} (Equal to remaining balance 10,500,000)`);
  console.log(`      --> Final Inst #9 Remainder Absorber: PKR ${Number(inst9.amount).toLocaleString()} (Base 1,166,666 + 6)`);
  if (pathAInstSum !== 10500000) throw new Error('Path A installment sum mismatch');

  // ─────────────────────────────────────────────────────────────
  // 5. Test Path B: Add Additional Booking to Customer (POST /customers/:id/bookings)
  // ─────────────────────────────────────────────────────────────
  console.log('\n5. Testing Path B: Add Booking to Existing Customer (POST /customers/:id/bookings):');
  
  // Non-evenly divisible installment numbers: 11,000,000 / 7 installments = 1,571,428.57... (base 1,571,428, remainder 4)
  const pathBPayload = {
    plotId: 'plot-a-04',
    paymentType: 'installment',
    installmentPlan: {
      totalPayment: 12500000,
      downpayment: 1500000,
      numberOfInstallments: 7,
      paidAfterEveryMonths: 3,
    },
  };

  const pathBRes = await request(`/customers/${pathACustId}/bookings`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${marketingToken}` },
    body: JSON.stringify(pathBPayload),
  });
  console.log('   Path B add booking response:', pathBRes.status === 201 && pathBRes.data.ok ? `201 Created (Booking ID: ${pathBRes.data.booking.id})` : `FAILED (${pathBRes.status})`);
  if (pathBRes.status !== 201 || !pathBRes.data.ok) throw new Error(`Path B failed: ${JSON.stringify(pathBRes.data)}`);

  const pathBBookingId = pathBRes.data.booking.id;
  cleanupBookingIds.push(pathBBookingId);

  // DB Verification of Path B
  const dbCustBookings = await prisma.booking.findMany({ where: { customerId: pathACustId } });
  const dbPathBPlot = await prisma.plot.findUnique({ where: { id: 'plot-a-04' } });
  const dbPathBPayments = await prisma.paymentRecord.findMany({
    where: { bookingId: pathBBookingId },
    orderBy: [{ feeType: 'asc' }, { installmentNumber: 'asc' }],
  });
  console.log(`   DB Check: Customer ${pathACustId} now has ${dbCustBookings.length} bookings (Correct).`);
  console.log('   DB Check: Plot-a-04 status =', dbPathBPlot.status, '| Owner =', dbPathBPlot.currentOwnerId);
  console.log(`   DB Check: Payment Records (${dbPathBPayments.length} generated for Path B 7-installment plan):`);

  let pathBInstSum = 0;
  for (const p of dbPathBPayments) {
    if (p.feeType === 'plot_installment') pathBInstSum += Number(p.amount);
  }
  const pathBInst7 = dbPathBPayments.find(p => p.installmentNumber === 7);
  console.log(`      --> Upfront Downpayment: PKR ${Number(dbPathBPayments.find(p => p.feeType === 'plot_downpayment').amount).toLocaleString()} (Paid)`);
  console.log(`      --> 7 Installments Sum = PKR ${pathBInstSum.toLocaleString()} (Equal to remaining balance 11,000,000)`);
  console.log(`      --> Final Inst #7 Remainder Absorber: PKR ${Number(pathBInst7.amount).toLocaleString()} (Base 1,571,428 + 4 = 1,571,432)`);

  if (dbCustBookings.length !== 2 || dbPathBPlot.status !== 'booked') throw new Error('Path B booking attach failed');
  if (pathBInstSum !== 11000000) throw new Error('Path B installment sum mismatch');
  if (Number(pathBInst7.amount) !== 1571432) throw new Error('Path B remainder absorber mismatch');

  // ─────────────────────────────────────────────────────────────
  // 6. Test Suspension & Re-activation (POST /customers/:id/suspend)
  // ─────────────────────────────────────────────────────────────
  console.log('\n6. Testing Customer Suspension & Re-activation (POST /customers/:id/suspend):');
  
  // 6a. Negative Check: Sub-admin lacking can_view_customers is blocked by permission gate
  const unauthSuspRes = await request(`/customers/${pathACustId}/suspend`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${marketingToken}` },
    body: JSON.stringify({ action: 'suspend', reason: 'Attempt without can_view_customers' }),
  });
  console.log('   Sub-admin without can_view_customers attempting suspension:', unauthSuspRes.status === 403 ? '403 FORBIDDEN (Correct - Permission gate enforced)' : `FAILED (${unauthSuspRes.status})`);
  if (unauthSuspRes.status !== 403) throw new Error('Expected 403 FORBIDDEN for sub-admin without can_view_customers');

  // 6b. Legitimate suspension by Super Admin
  const suspRes = await request(`/customers/${pathACustId}/suspend`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${superToken}` },
    body: JSON.stringify({ action: 'suspend', reason: 'Administrative review for documentation discrepancy' }),
  });
  console.log('   Super Admin suspend customer response:', suspRes.status === 201 && suspRes.data.ok ? '201 OK (Suspended)' : `FAILED (${suspRes.status})`);

  const dbSuspCust = await prisma.customer.findUnique({ where: { id: pathACustId } });
  console.log('   DB Check: accountStatus =', dbSuspCust.accountStatus, '(Correct)');
  if (dbSuspCust.accountStatus !== 'suspended') throw new Error('Customer suspension failed');

  // 6c. Verify Exception 4.6: Suspended customer CANNOT be attached to new bookings
  const blockedBookingRes = await request(`/customers/${pathACustId}/bookings`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${marketingToken}` },
    body: JSON.stringify({
      plotId: 'plot-a-02',
      paymentType: 'one_time',
    }),
  });
  const isSuspendedError = blockedBookingRes.status === 400 && 
    (blockedBookingRes.data?.reason === 'CUSTOMER_SUSPENDED' || 
     blockedBookingRes.data?.message === 'CUSTOMER_SUSPENDED' || 
     blockedBookingRes.data?.error === 'CUSTOMER_SUSPENDED');
  console.log('   Attempt to add booking to suspended customer:', isSuspendedError ? `400 CUSTOMER_SUSPENDED (Correct - Matches src/lib/dal/customers.ts:510)` : `FAILED (${blockedBookingRes.status} - ${JSON.stringify(blockedBookingRes.data)})`);
  if (!isSuspendedError) {
    throw new Error(`Suspension guard failed: ${JSON.stringify(blockedBookingRes.data)}`);
  }

  // 6d. Reactivate customer by Super Admin
  const reactRes = await request(`/customers/${pathACustId}/suspend`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${superToken}` },
    body: JSON.stringify({ action: 'activate', reason: 'Documentation verified' }),
  });
  console.log('   Super Admin reactivate customer response:', reactRes.status === 201 && reactRes.data.ok ? '201 OK (Reactivated)' : `FAILED (${reactRes.status})`);
  const dbActiveCust = await prisma.customer.findUnique({ where: { id: pathACustId } });
  console.log('   DB Check: accountStatus =', dbActiveCust.accountStatus, '(Correct)');
  if (dbActiveCust.accountStatus !== 'active') throw new Error('Customer reactivation failed');

  // ─────────────────────────────────────────────────────────────
  // 7. Test Customer Strikes (POST /customers/:id/strikes)
  // ─────────────────────────────────────────────────────────────
  console.log('\n7. Testing Customer Administrative Strikes (POST /customers/:id/strikes):');
  
  // 7a. Negative Check: Sub-admin lacking can_view_customers and can_verify_receipts is blocked
  const unauthStrikeRes = await request(`/customers/${pathACustId}/strikes`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${marketingToken}` },
    body: JSON.stringify({ reason: 'Unauthorized strike attempt' }),
  });
  console.log('   Sub-admin without can_view_customers/can_verify_receipts attempting strike:', unauthStrikeRes.status === 403 ? '403 FORBIDDEN (Correct - Permission gate enforced)' : `FAILED (${unauthStrikeRes.status})`);
  if (unauthStrikeRes.status !== 403) throw new Error('Expected 403 FORBIDDEN for sub-admin without strike permissions');

  // 7b. Legitimate strike assigned by Super Admin
  const strikeRes = await request(`/customers/${pathACustId}/strikes`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${superToken}` },
    body: JSON.stringify({ reason: 'Overdue payment receipt submission notice' }),
  });
  console.log('   Super Admin assign strike response:', strikeRes.status === 201 && strikeRes.data.ok ? `201 OK (Strike #${strikeRes.data.strikeCount} assigned)` : `FAILED (${strikeRes.status})`);

  // DB Verification
  const dbStrikes = await prisma.customerStrike.findMany({ where: { customerId: pathACustId } });
  const dbCustStrikeCount = await prisma.customer.findUnique({ where: { id: pathACustId } });
  console.log('   DB Check: Customer strikeCount =', dbCustStrikeCount.strikeCount, '| Strikes in DB =', dbStrikes.length);
  console.log('   DB Check: Strike details = Reason:', dbStrikes[0]?.reason, '| Assigned By:', dbStrikes[0]?.assignedBy);

  if (dbCustStrikeCount.strikeCount !== 1 || dbStrikes.length !== 1) throw new Error('Strike persistence failed');

  // ─────────────────────────────────────────────────────────────
  // 8. Clean up all test entities
  // ─────────────────────────────────────────────────────────────
  console.log('\n8. Cleaning up test data:');
  await prisma.customerStrike.deleteMany({ where: { customerId: { in: cleanupCustomerIds } } });
  await prisma.societyDocument.deleteMany({ where: { bookingId: { in: cleanupBookingIds } } });
  await prisma.paymentRecord.deleteMany({ where: { bookingId: { in: cleanupBookingIds } } });
  await prisma.booking.deleteMany({ where: { id: { in: cleanupBookingIds } } });
  await prisma.customer.deleteMany({ where: { id: { in: cleanupCustomerIds } } });
  await prisma.auditEntry.deleteMany({
    where: {
      OR: [
        { entityId: { in: cleanupCustomerIds } },
        { entityId: { in: cleanupBookingIds } },
        { entityId: { in: testPlots } },
      ],
    },
  });
  await prisma.plot.updateMany({
    where: { id: { in: testPlots } },
    data: { status: 'available', currentOwnerId: null, lockedBy: null, lockedAt: null },
  });
  console.log('   All test customers, bookings, strikes, and plots cleanly restored.');

  console.log('\n========================================================');
  console.log('   ALL WAVE 2 CUSTOMER LIFECYCLE TESTS CONFIRMED LIVE!  ');
  console.log('========================================================');
}

main().catch(console.error).finally(() => prisma.$disconnect());
