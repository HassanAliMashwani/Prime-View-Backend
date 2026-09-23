const path = require('path');
const envHelper = require(path.join(__dirname, 'scripts/verification/env-helper.js'));
envHelper.initEnv();
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } } });

async function main() {
  const sql = fs.readFileSync('prisma/rls_updates.sql', 'utf8');
  try {
    await prisma.$executeRawUnsafe(sql);
    console.log('RLS reapplied successfully via one query.');
  } catch (e) {
    console.log('Error executing block:', e.message);
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
