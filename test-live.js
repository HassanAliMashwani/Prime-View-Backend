const https = require('https');

async function login(url, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch(e) {
          resolve(data);
        }
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

async function testApi(url, token) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const req = https.request(url, {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          path: new URL(url).pathname,
          status: res.statusCode,
          ttfb: res.ttfb || (Date.now() - start),
          total: Date.now() - start,
          size: Buffer.byteLength(data, 'utf8')
        });
      });
    });
    req.on('response', (res) => {
       res.ttfb = Date.now() - start;
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  try {
    const adminLogin = await login('https://prime-view-backend.onrender.com/auth/admin/login', { username: 'admin', password: 'admin123' });
    const adminToken = adminLogin.token || adminLogin.access_token || adminLogin.data?.token || adminLogin.session?.token;
    
    if (adminToken) {
      console.log('--- COLD ---');
      const c1 = await testApi('https://prime-view-backend.onrender.com/customers', adminToken);
      console.log('GET /customers cold:', c1);

      const c2 = await testApi('https://prime-view-backend.onrender.com/sales/history', adminToken);
      console.log('GET /sales/history cold:', c2);

      console.log('--- WARM ---');
      const w1 = await testApi('https://prime-view-backend.onrender.com/customers', adminToken);
      console.log('GET /customers warm:', w1);

      const w2 = await testApi('https://prime-view-backend.onrender.com/sales/history', adminToken);
      console.log('GET /sales/history warm:', w2);
    }
  } catch (err) {
    console.error(err);
  }
}

main();
