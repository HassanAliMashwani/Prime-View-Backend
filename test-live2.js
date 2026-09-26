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
    const custLogin = await login('https://prime-view-backend.onrender.com/auth/member/login', { membershipNo: 'PV-2024-001', password: 'password123' });
    const custToken = custLogin.token || custLogin.access_token || custLogin.data?.token || custLogin.session?.token;
    
    if (custToken) {
      console.log('--- COLD ---');
      const c3 = await testApi('https://prime-view-backend.onrender.com/me/plots', custToken);
      console.log('GET /me/plots cold:', c3);
      const c4 = await testApi('https://prime-view-backend.onrender.com/me/payments', custToken);
      console.log('GET /me/payments cold:', c4);

      console.log('--- WARM ---');
      const w3 = await testApi('https://prime-view-backend.onrender.com/me/plots', custToken);
      console.log('GET /me/plots warm:', w3);
      const w4 = await testApi('https://prime-view-backend.onrender.com/me/payments', custToken);
      console.log('GET /me/payments warm:', w4);
    } else {
        console.log("No token for customer:", custLogin);
    }
  } catch (err) {
    console.error(err);
  }
}

main();
