import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "PaymentRecord" ADD COLUMN IF NOT EXISTS "paidDate" TIMESTAMP(3);`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "PaymentRecord" ADD COLUMN IF NOT EXISTS "transactionRef" TEXT;`);
    console.log("Table altered successfully.");
  } catch (err) {
    console.error("Alter error:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
