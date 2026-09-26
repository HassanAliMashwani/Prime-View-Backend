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
    await prisma.$executeRawUnsafe(`ALTER TABLE "PaymentRecord" ADD COLUMN IF NOT EXISTS "paidDate" TIMESTAMP(3);`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "PaymentRecord" ADD COLUMN IF NOT EXISTS "transactionRef" TEXT;`);
    console.log("Table altered successfully as postgres user.");
  } catch (err) {
    console.error("Alter error:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
