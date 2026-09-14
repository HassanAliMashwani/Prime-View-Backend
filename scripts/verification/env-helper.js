const fs = require('fs');
const path = require('path');

function initEnv() {
  const candidatePaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(__dirname, '../../.env'),
    path.resolve(__dirname, '../.env'),
    path.resolve(__dirname, '.env'),
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      try {
        const text = fs.readFileSync(p, 'utf8');
        for (const line of text.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eq = trimmed.indexOf('=');
          if (eq > 0) {
            const k = trimmed.substring(0, eq).trim();
            let v = trimmed.substring(eq + 1).trim();
            if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
              v = v.slice(1, -1);
            }
            if (!process.env[k]) {
              process.env[k] = v;
            }
          }
        }
        break;
      } catch {}
    }
  }

  return {
    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_URL: process.env.DIRECT_URL,
    PORT: process.env.PORT || 3001,
    TEST_ADMIN_PASSWORD: process.env.TEST_ADMIN_PASSWORD || 'password123',
    TEST_MEMBER_PASSWORD: process.env.TEST_MEMBER_PASSWORD || 'password123',
    PROJECT_ROOT: path.resolve(__dirname, '../../'),
  };
}

module.exports = { initEnv };
