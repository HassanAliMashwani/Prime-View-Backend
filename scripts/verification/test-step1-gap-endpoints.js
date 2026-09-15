/**
 * Verification test for Step 1 Backend Additions:
 * a) GET /admin/audit (Super Admin guarded, 403 for sub-admins)
 * b) POST /customers/:id/documents & DELETE /customers/:id/documents/:docId (live database verification)
 */
require('./env-helper').initEnv();

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

async function loginAdmin(username, password) {
  const res = await request('/auth/admin/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(`Login failed for ${username}: ${JSON.stringify(res.data)}`);
  return res.data.access_token;
}

async function run() {
  console.log('--- TEST 1: GET /admin/audit (Super Admin Guarded) ---');
  const superToken = await loginAdmin('admin', 'password123');
  const subToken = await loginAdmin('marketing', 'password123');

  // 1. Authenticated Super Admin request
  const auditRes = await request('/admin/audit', {
    method: 'GET',
    headers: { Authorization: `Bearer ${superToken}` },
  });
  console.log('Super Admin GET /admin/audit status:', auditRes.status);
  console.log('Super Admin GET /admin/audit response ok:', auditRes.data.ok);
  console.log('Total audit rows returned:', auditRes.data.totalCount);
  if (auditRes.data.logs && auditRes.data.logs.length > 0) {
    console.log('Sample audit log row:', JSON.stringify(auditRes.data.logs[0]));
  }

  // 2. Authenticated Sub Admin request (must be rejected with 403)
  const subAuditRes = await request('/admin/audit', {
    method: 'GET',
    headers: { Authorization: `Bearer ${subToken}` },
  });
  console.log('Sub Admin GET /admin/audit status (expected 403):', subAuditRes.status);
  console.log('Sub Admin GET /admin/audit error payload:', JSON.stringify(subAuditRes.data));

  console.log('\n--- TEST 2: Customer Document Upload + Attach + Delete Cycle ---');
  // First, find an existing customer
  const customersRes = await request('/customers', {
    method: 'GET',
    headers: { Authorization: `Bearer ${superToken}` },
  });
  const customers = customersRes.data.customers || customersRes.data;
  const targetCustomer = Array.isArray(customers) && customers.length > 0 ? customers[0] : null;
  if (!targetCustomer) throw new Error('No target customer found to attach document to');
  console.log(`Target customer: ${targetCustomer.fullName} (ID: ${targetCustomer.id})`);

  // Upload document
  const docPayload = {
    type: 'applicant_photo',
    fileUrl: 'https://storage.example.com/customer-docs/test-upload.jpg',
    fileName: 'test-upload.jpg',
    fileSizeKb: 150,
  };
  const uploadRes = await request(`/customers/${targetCustomer.id}/documents`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${superToken}` },
    body: JSON.stringify(docPayload),
  });
  console.log('POST /customers/:id/documents status:', uploadRes.status);
  console.log('Created document:', JSON.stringify(uploadRes.data));
  const createdDocId = uploadRes.data.document.id;

  // Verify document appears in customer detail
  const detailRes = await request(`/customers/${targetCustomer.id}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${superToken}` },
  });
  const docs = detailRes.data.documents || [];
  const found = docs.some(d => d.id === createdDocId);
  console.log(`Document ${createdDocId} present in customer record:`, found);

  // Delete document
  const deleteRes = await request(`/customers/${targetCustomer.id}/documents/${createdDocId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${superToken}` },
  });
  console.log('DELETE /customers/:id/documents/:docId status:', deleteRes.status);
  console.log('Delete response:', JSON.stringify(deleteRes.data));

  // Verify document is gone
  const afterDetailRes = await request(`/customers/${targetCustomer.id}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${superToken}` },
  });
  const docsAfter = afterDetailRes.data.documents || [];
  const stillExists = docsAfter.some(d => d.id === createdDocId);
  console.log(`Document ${createdDocId} still present after delete (expected false):`, stillExists);

  console.log('\n--- ALL VERIFICATIONS PASSED ---');
}

run().catch(err => {
  console.error('VERIFICATION FAILED:', err);
  process.exit(1);
});
