const http = require('http');

const measure = (path, method = 'GET', body = null, token = null) => {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const options = {
      hostname: 'localhost',
      port: 3001,
      path,
      method,
      headers: {}
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    if (body) {
      options.headers['Content-Type'] = 'application/json';
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        const end = performance.now();
        const duration = (end - start).toFixed(2);
        resolve({ status: res.statusCode, duration, length: data.length });
      });
    });

    req.on('error', e => reject(e));
    
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
};

async function run() {
  console.log('Testing GET /blocks...');
  const b = await measure('/blocks', 'GET', null, token);
  console.log(`GET /blocks -> Status: ${b.status}, Time: ${b.duration}ms, Size: ${b.length} bytes`);
  
  // Need to get an admin token to test protected routes.
  // We can just log into admin
  const loginStart = performance.now();
  const loginReq = await new Promise((resolve) => {
    const req = http.request({
      hostname: 'localhost',
      port: 3001,
      path: '/auth/admin/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.write(JSON.stringify({ username: "admin", password: "admin123" }));
    req.end();
  });
  
  if (!loginReq.access_token) {
    console.log('Login failed', loginReq);
    return;
  }
  
  const token = loginReq.access_token;
  
  console.log('\nTesting GET /customers...');
  const c = await measure('/customers', 'GET', null, token);
  console.log(`GET /customers -> Status: ${c.status}, Time: ${c.duration}ms, Size: ${c.length} bytes`);
  
  console.log('\nTesting GET /sales/history...');
  const s = await measure('/sales/history', 'GET', null, token);
  console.log(`GET /sales/history -> Status: ${s.status}, Time: ${s.duration}ms, Size: ${s.length} bytes`);
  
  console.log('\nTesting GET /plots?blockId=abbott...');
  const p = await measure('/plots?blockId=abbott', 'GET', null, token);
  console.log(`GET /plots?blockId=abbott -> Status: ${p.status}, Time: ${p.duration}ms, Size: ${p.length} bytes`);
}

run().catch(console.error);
