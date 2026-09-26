import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    // We use raw SQL because Prisma Client expects paidDate which isn't in the remote DB schema yet
    console.log("Fixing installment 24...");
    const res = await prisma.$executeRawUnsafe(`
      UPDATE "PaymentRecord"
      SET "paidAmount" = 270841, "amount" = 270841
      WHERE "installmentNumber" = 24
      AND "feeType" = 'plot_installment'
      AND "bookingId" IN (
        SELECT id FROM "Booking" WHERE "plotId" IN (
          SELECT id FROM "Plot" WHERE "plotNumber" = 'B-05'
        )
      )
    `);
    console.log("Rows affected:", res);
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
