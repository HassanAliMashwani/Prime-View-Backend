import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "postgresql://postgres.nnuyccntmxhrkbbsnmwn:primeview.124@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
    }
  }
});

async function main() {
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Plot" ADD COLUMN IF NOT EXISTS "lockReason" TEXT;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "Plot" ADD COLUMN IF NOT EXISTS "lockedByName" TEXT;`);
    console.log("Plot table altered successfully with lockReason and lockedByName.");
  } catch (err) {
    console.error("Alter error:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
