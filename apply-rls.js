const path = require('path');
const envHelper = require(path.join(__dirname, 'scripts/verification/env-helper.js'));
envHelper.initEnv();
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } } });

async function main() {
  const sql = fs.readFileSync('prisma/rls_updates.sql', 'utf8');
  const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);
  for (const stmt of statements) {
    if (stmt.startsWith('--')) continue; // Very basic check
    try {
      await prisma.$executeRawUnsafe(stmt);
    } catch (e) {
      console.log('Error executing:', stmt.substring(0, 50), e.message);
    }
  }
  console.log('RLS reapplied.');
}
main().catch(console.error).finally(() => prisma.$disconnect());
