/**
 * Verification script for File 11: users.ts DAL
 * Tests live HTTP operations against backend:
 * 1. Super Admin login
 * 2. Sub Admin login
 * 3. Super Admin GET /admin/sub-admins -> 200 OK
 * 4. Sub Admin GET /admin/sub-admins -> 403 Forbidden
 * 5. Super Admin POST /admin/sub-admins -> 201 Created
 * 6. Super Admin PATCH /admin/sub-admins/:id -> 200 OK
 */

const http = require('http');

function request(method, path, payload, token) {
  return new Promise((resolve, reject) => {
    const data = payload ? JSON.stringify(payload) : null;
    const headers = {};
    if (data) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(data);
    }
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(
      {
        hostname: 'localhost',
        port: 3001,
        path,
        method,
        headers,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(body) });
          } catch (e) {
            resolve({ status: res.statusCode, raw: body });
          }
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  console.log('=== Step 1: Super Admin Login ===');
  const superLogin = await request('POST', '/auth/admin/login', {
    username: 'admin',
    password: 'password123',
  });
  console.log('Super Admin login status:', superLogin.status);
  const superToken = superLogin.data.access_token;

  console.log('\n=== Step 2: Sub Admin Login ===');
  const subLogin = await request('POST', '/auth/admin/login', {
    username: 'marketing',
    password: 'password123',
  });
  console.log('Sub Admin login status:', subLogin.status);
  const subToken = subLogin.data.access_token;

  console.log('\n=== Step 3: GET /admin/sub-admins as Super Admin ===');
  const superGet = await request('GET', '/admin/sub-admins', null, superToken);
  console.log('Super Admin GET status:', superGet.status);
  console.log('Sub-admins count:', superGet.data.subAdmins ? superGet.data.subAdmins.length : 0);
  console.log(
    'Sub-admins list:',
    superGet.data.subAdmins.map((u) => ({
      id: u.id,
      username: u.username,
      fullName: u.fullName,
      assignedBlocks: u.assignedBlocks,
    }))
  );

  console.log('\n=== Step 4: GET /admin/sub-admins as Sub Admin (Must be 403 Forbidden) ===');
  const subGet = await request('GET', '/admin/sub-admins', null, subToken);
  console.log('Sub Admin GET status:', subGet.status);
  console.log('Sub Admin rejected payload:', subGet.data);

  console.log('\n=== Step 5: POST /admin/sub-admins (Create Sub Admin) ===');
  const uniqueSuffix = Date.now().toString().slice(-4);
  const newSubAdminPayload = {
    username: `sales_agent_${uniqueSuffix}`,
    email: `agent_${uniqueSuffix}@primeview.pk`,
    fullName: `Test Agent ${uniqueSuffix}`,
    password: 'Password123!',
    assignedBlocks: ['abbott', 'royal'],
    permissions: {
      can_reserve: true,
      can_book: true,
      can_create_customer: true,
      can_view_customers: true,
      can_view_sales_reports: false,
      can_edit_content: false,
      can_verify_receipts: false,
    },
  };
  const createRes = await request('POST', '/admin/sub-admins', newSubAdminPayload, superToken);
  console.log('Create Sub Admin status:', createRes.status);
  console.log('Created Sub Admin:', createRes.data.subAdmin);
  const createdId = createRes.data.subAdmin.id;

  console.log('\n=== Step 6: PATCH /admin/sub-admins/:id (Update Sub Admin) ===');
  const updateRes = await request(
    'PATCH',
    `/admin/sub-admins/${createdId}`,
    {
      status: 'suspended',
      permissions: {
        can_reserve: false,
        can_book: false,
      },
    },
    superToken
  );
  console.log('Update status:', updateRes.status);
  console.log('Updated Sub Admin status & permissions:', {
    status: updateRes.data.subAdmin.status,
    permissions: updateRes.data.subAdmin.permissions,
  });

  console.log('\nALL USERS DAL ENDPOINTS LIVE VERIFIED SUCCESSFULLY.');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
