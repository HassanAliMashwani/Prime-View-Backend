const fs = require('fs');
const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (m) env[m[1]] = (m[2] || '').trim().replace(/^['"]|['"]$/g, '');
}
const dbUrl = process.env.DATABASE_URL || env.DATABASE_URL;
if (dbUrl) {
  const parsed = new URL(dbUrl);
  console.log('Host:', parsed.host);
  console.log('Username:', parsed.username);
}
