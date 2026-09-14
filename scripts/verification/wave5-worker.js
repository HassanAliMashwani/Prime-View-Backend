/**
 * wave5-worker.js
 * Standalone worker process for Wave 5 Dual-Process Concurrency Verification
 * Fires a single POST /plots/:id/book at a precisely synchronized millisecond
 */
const http = require('http');

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].substring(2);
      const val = (i + 1 < args.length && !args[i + 1].startsWith('--')) ? args[++i] : true;
      parsed[key] = val;
    }
  }
  return parsed;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

async function main() {
  const args = parseArgs();
  const plotId = args.plotId;
  const token = args.token;
  const workerId = args.workerId || 'Worker';
  const syncTime = Number(args.syncTime || 0);
  const simulateRollback = args.simulateRollback === true || args.simulateRollback === 'true';

  if (!plotId || !token) {
    console.error(JSON.stringify({ error: 'MISSING_REQUIRED_ARGS', args }));
    process.exit(1);
  }

  // Synchronize to exact target millisecond
  const now = Date.now();
  if (syncTime > now) {
    await sleep(syncTime - now);
  }

  const action = args.action || 'book'; // 'book' or 'reserve'
  const requestStartTime = Date.now();

  let payloadObj;
  let endpointPath;

  if (action === 'reserve') {
    endpointPath = `/plots/${plotId}/reserve`;
    payloadObj = {
      customerName: `Reservation Client ${workerId}`,
      customerPhone: `+92300998877${workerId === 'A' ? '1' : '2'}`,
      customerEmail: `res.client.${workerId.toLowerCase()}.${Date.now()}@example.com`,
      tokenFee: 50000,
      validDays: 7,
      note: `Concurrent reservation race test by Worker ${workerId}`,
    };
  } else {
    endpointPath = `/plots/${plotId}/book`;
    payloadObj = {
      paymentType: 'one_time',
      customer: {
        fullName: `Concurrency Buyer ${workerId}`,
        email: `buyer.${workerId.toLowerCase()}.${Date.now()}@primeview.pk`,
        phone: `+92300111223${workerId === 'A' ? '1' : '2'}`,
        cnic: `37405-1234567-${workerId === 'A' ? '1' : '2'}`,
        fatherOrHusbandName: `Father of ${workerId}`,
        mailingAddress: `Test Address Block ${workerId}`,
      },
      simulateRollback,
    };
  }

  const payload = JSON.stringify(payloadObj);

  const reqOptions = {
    hostname: 'localhost',
    port: 3001,
    path: endpointPath,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      'Authorization': `Bearer ${token}`,
    },
  };

  const response = await new Promise((resolve) => {
    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsedBody = data;
        try {
          parsedBody = JSON.parse(data);
        } catch {}
        resolve({
          statusCode: res.statusCode,
          statusMessage: res.statusMessage,
          body: parsedBody,
        });
      });
    });

    req.on('error', (err) => {
      resolve({
        statusCode: 0,
        error: err.message,
      });
    });

    req.write(payload);
    req.end();
  });

  const responseEndTime = Date.now();

  const output = {
    workerId,
    pid: process.pid,
    plotId,
    requestStartTime,
    responseEndTime,
    durationMs: responseEndTime - requestStartTime,
    statusCode: response.statusCode,
    body: response.body,
    error: response.error || null,
  };

  console.log(JSON.stringify(output));
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
});
