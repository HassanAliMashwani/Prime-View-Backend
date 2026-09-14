const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

function getDbUrl() {
  if (process.env.DIRECT_URL) return process.env.DIRECT_URL;
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const candidatePaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(__dirname, '../../../.env'),
    path.resolve(__dirname, '../../.env'),
    path.resolve(__dirname, '.env'),
  ];
  for (const envPath of candidatePaths) {
    if (fs.existsSync(envPath)) {
      const text = fs.readFileSync(envPath, 'utf8');
      const m = text.match(/(DIRECT_URL|DATABASE_URL)="([^"]+)"/);
      if (m) return m[2];
    }
  }
  return undefined;
}

const prisma = new PrismaClient({
  datasources: { db: { url: getDbUrl() } }
});

async function run() {
  const objs = await prisma.$queryRawUnsafe('SELECT bucket_id, name, metadata FROM storage.objects LIMIT 10');
  console.log('Objects in storage.objects:', objs);
  await prisma.$disconnect();
}

run().catch(console.error);
