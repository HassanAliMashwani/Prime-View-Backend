require('dotenv').config();
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DIRECT_URL } }
  });
  
  const sql = fs.readFileSync(path.join(__dirname, '../prisma/rls.sql'), 'utf8');
  const queries = sql.split(';').map(q => q.trim()).filter(q => q.length > 0);
  for (const q of queries) {
    try {
      await prisma.$executeRawUnsafe(q + ';');
    } catch (e) {
      console.error(e.message);
    }
  }
  
  const sql2 = fs.readFileSync(path.join(__dirname, '../prisma/rls_updates.sql'), 'utf8');
  const queries2 = sql2.split(';').map(q => q.trim()).filter(q => q.length > 0);
  for (const q of queries2) {
    try {
      await prisma.$executeRawUnsafe(q + ';');
    } catch (e) {
      console.error(e.message);
    }
  }
  console.log('Applied RLS successfully!');
}

main().catch(console.error).finally(() => process.exit(0));
