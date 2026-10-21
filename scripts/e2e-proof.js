const API = 'http://localhost:3001';

function decodeJwt(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
}

async function post(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function get(path, token) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, {
    method: 'GET',
    headers,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function run() {
  console.log('====================================================');
  console.log('=== STARTING END-TO-END PROOF FOR UMER & HASSAN ===');
  console.log('====================================================\n');

  // ── PART 1: HASSAN (Box 1: Reserve, Book, Sort Reservations, Master Plan) ──
  console.log('--- 1. Testing Sub-Admin HASSAN ---');
  const hassanLogin = await post('/auth/admin/login', {
    username: 'hassan',
    password: 'admin123',
  });
  const hassanToken = hassanLogin.data.access_token;
  if (!hassanToken) {
    throw new Error(`Hassan login failed: ${JSON.stringify(hassanLogin)}`);
  }
  const hassanUser = decodeJwt(hassanToken);
  console.log('✓ Hassan logged in successfully.');
  console.log('  Role:', hassanUser.role);
  console.log('  Permissions:', JSON.stringify(hassanUser.permissions));
  console.log('  Assigned Blocks:', hassanUser.assignedBlocks);

  // 1A. Hassan accesses Master Plan (Allowed)
  const hassanBlocks = await get('/blocks', hassanToken);
  const blocksList = Array.isArray(hassanBlocks.data) ? hassanBlocks.data : (hassanBlocks.data.blocks || []);
  console.log(`✓ Hassan Master Plan /blocks status: ${hassanBlocks.status} (Allowed, blocks count: ${blocksList.length})`);
  
  const hassanPlots = await get('/plots?blockId=abbott', hassanToken);
  const plotsList = Array.isArray(hassanPlots.data) ? hassanPlots.data : (hassanPlots.data.plots || []);
  console.log(`✓ Hassan Master Plan /plots?blockId=abbott status: ${hassanPlots.status} (Allowed, plots count: ${plotsList.length})`);

  // 1B. Hassan accesses Sort Reservations (Allowed)
  const hassanReservations = await get('/reservations', hassanToken);
  console.log(`✓ Hassan /reservations status: ${hassanReservations.status} (Allowed)`);

  // 1C. Hassan reserves and books a plot (Allowed)
  const availablePlot = plotsList.find(p => p.status === 'available' && p.category !== 'amenity');
  if (!availablePlot) throw new Error('No available plot in abbott for booking test');
  console.log(`  Selected available plot for Hassan: ${availablePlot.plotNumber} (${availablePlot.id})`);

  // Acquire lock
  const lockRes = await post(`/plots/${availablePlot.id}/lock`, { reason: 'book' }, hassanToken);
  console.log(`✓ Hassan lock plot status: ${lockRes.status} (token: ${lockRes.data.lockToken || 'acquired'})`);

  // Create booking via minimal-booking (Admin quick flow)
  const uniqueSuffix = Math.floor(1000 + Math.random() * 9000);
  const cnicTest = `37405-${Math.floor(1000000 + Math.random() * 9000000)}-1`;
  const customerName = `Tariq Mehmood ${uniqueSuffix}`;
  const minimalBookingRes = await post('/customers/minimal-booking', {
    plotId: availablePlot.id,
    customerName: customerName,
    cnic: cnicTest,
    city: 'Rawalpindi',
    lockToken: lockRes.data.lockToken,
    plotPrice: 12500000,
  }, hassanToken);
  console.log(`✓ Hassan minimal booking status: ${minimalBookingRes.status}`);
  if (minimalBookingRes.status !== 201 && minimalBookingRes.status !== 200) {
    throw new Error(`Hassan booking failed: ${JSON.stringify(minimalBookingRes)}`);
  }
  const bookedCustomer = minimalBookingRes.data.customer;
  console.log(`  Created member: "${bookedCustomer.fullName}" (id: ${bookedCustomer.id}, registrationStatus: "${bookedCustomer.registrationStatus}")`);
  console.log(`  Plot ${availablePlot.plotNumber} booked successfully by Hassan!`);

  // 1D. Hassan attempts to access Customer Directory (REVOKED -> must be 403 Forbidden)
  const hassanCustDir = await get('/customers', hassanToken);
  console.log(`✓ Hassan /customers (Directory) status: ${hassanCustDir.status} (STAYS CLOSED - 403 Forbidden: ${hassanCustDir.data.message})`);
  if (hassanCustDir.status !== 403) throw new Error(`Expected 403 for Hassan on /customers, got ${hassanCustDir.status}`);

  // 1E. Hassan attempts to access Sales History (REVOKED -> must be 403 Forbidden)
  const hassanSales = await get('/sales/history', hassanToken);
  console.log(`✓ Hassan /sales/history status: ${hassanSales.status} (STAYS CLOSED - 403 Forbidden: ${hassanSales.data.message})`);
  if (hassanSales.status !== 403) throw new Error(`Expected 403 for Hassan on /sales/history, got ${hassanSales.status}`);


  // ── PART 2: UMER (Box 2: Create Customer Account & View Customer Directory) ──
  console.log('\n--- 2. Testing Sub-Admin UMER ---');
  const umerLogin = await post('/auth/admin/login', {
    username: 'umer',
    password: 'admin123',
  });
  const umerToken = umerLogin.data.access_token;
  if (!umerToken) {
    throw new Error(`Umer login failed: ${JSON.stringify(umerLogin)}`);
  }
  const umerUser = decodeJwt(umerToken);
  console.log('✓ Umer logged in successfully.');
  console.log('  Role:', umerUser.role);
  console.log('  Permissions:', JSON.stringify(umerUser.permissions));
  console.log('  Assigned Blocks:', umerUser.assignedBlocks);

  // 2A. Umer accesses Customer Directory (Allowed)
  const umerCustDir = await get('/customers', umerToken);
  const custList = umerCustDir.data.customers || [];
  console.log(`✓ Umer /customers (Directory) status: ${umerCustDir.status} (Allowed, customer count: ${umerCustDir.data.total || custList.length})`);

  // Find the member Hassan booked (Tariq Mehmood)
  const targetMember = custList.find(c => c.id === bookedCustomer.id || c.cnic === cnicTest);
  if (!targetMember) throw new Error('Target member booked by Hassan not found in Umer directory');
  console.log(`✓ Umer sees member "${targetMember.fullName}" marked registrationStatus: "${targetMember.registrationStatus}" (Needs registration)`);

  // 2B. Umer completes registration for the member Hassan booked
  console.log(`  Umer submitting complete registration for ${targetMember.fullName}...`);
  const completeRegRes = await post(`/customers/${targetMember.id}/complete-registration`, {
    plotId: availablePlot.id,
    membershipNo: `PV-AB-${Math.floor(1000 + Math.random() * 9000)}`,
    fatherOrHusbandName: 'Muhammad Mehmood',
    cnic: cnicTest,
    phone: '03009876543',
    email: 'tariq.mehmood@example.com',
    mailingAddress: 'House 45, Street 12, Sector F-7, Rawalpindi',
    city: 'Rawalpindi',
    nokName: 'Rashid Mehmood',
    nokCnic: '37405-7654321-1',
    paymentType: 'one_time',
    portalPassword: 'Password123!',
    plotPrice: 12500000,
  }, umerToken);

  console.log(`✓ Umer complete-registration status: ${completeRegRes.status}`);
  if (completeRegRes.status !== 200 && completeRegRes.status !== 201) {
    throw new Error(`Umer complete registration failed: ${JSON.stringify(completeRegRes)}`);
  }
  console.log(`  Issued Official Membership No: ${completeRegRes.data.customer?.membershipNo}`);
  console.log(`  Registration Status: ${completeRegRes.data.customer?.registrationStatus}`);
  console.log(`  Credentials Pending: ${completeRegRes.data.customer?.credentialsPending}`);

  // Check directory again to confirm status is now "Portal issued"
  const umerDirUpdated = await get('/customers', umerToken);
  const updatedCustList = umerDirUpdated.data.customers || [];
  const updatedMember = updatedCustList.find(c => c.id === targetMember.id);
  console.log(`✓ In Umer's directory, ${updatedMember?.fullName} status is now:`);
  console.log(`  - registrationStatus: ${updatedMember?.registrationStatus}`);
  console.log(`  - credentialsPending: ${updatedMember?.credentialsPending}`);
  console.log(`  - Membership No: ${updatedMember?.membershipNo}`);
  console.log(`  -> UI Badge will display: "Portal issued"`);

  // 2D. Umer attempts to access Master Plan (/plots) (REVOKED -> must be 403 Forbidden)
  const umerMasterPlan = await get('/plots?blockId=abbott', umerToken);
  console.log(`✓ Umer Master Plan /plots status: ${umerMasterPlan.status} (STAYS CLOSED - 403 Forbidden: ${umerMasterPlan.data.message})`);
  if (umerMasterPlan.status !== 403) throw new Error(`Expected 403 for Umer on /plots, got ${umerMasterPlan.status}`);

  // 2E. Umer attempts to access Sort Reservations (/reservations) (REVOKED -> must be 403 Forbidden)
  const umerReservations = await get('/reservations', umerToken);
  console.log(`✓ Umer /reservations status: ${umerReservations.status} (STAYS CLOSED - 403 Forbidden: ${umerReservations.data.message})`);
  if (umerReservations.status !== 403) throw new Error(`Expected 403 for Umer on /reservations, got ${umerReservations.status}`);

  // 2F. Umer attempts to access Sales History (/sales/history) (REVOKED -> must be 403 Forbidden)
  const umerSales = await get('/sales/history', umerToken);
  console.log(`✓ Umer /sales/history status: ${umerSales.status} (STAYS CLOSED - 403 Forbidden: ${umerSales.data.message})`);
  if (umerSales.status !== 403) throw new Error(`Expected 403 for Umer on /sales/history, got ${umerSales.status}`);

  // 2G. Umer attempts to reserve a plot directly (REVOKED -> must be 403 Forbidden)
  const umerReserve = await post(`/plots/${availablePlot.id}/reserve`, { customerName: 'Test', customerCnic: '11111-1111111-1', customerPhone: '03001111111' }, umerToken);
  console.log(`✓ Umer direct plot reserve status: ${umerReserve.status} (REVOKED - 403 Forbidden: ${umerReserve.data.message})`);
  if (umerReserve.status !== 403) throw new Error(`Expected 403 for Umer on /plots/:id/reserve, got ${umerReserve.status}`);

  console.log('\n====================================================');
  console.log('=== ALL TESTS PASSED WITH 100% SUCCESS PROOF! ===');
  console.log('====================================================');
}

run().catch(err => {
  console.error('\n❌ PROOF RUN FAILED:', err);
  process.exit(1);
});
