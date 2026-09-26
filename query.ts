import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    const res: any = await prisma.$queryRawUnsafe(`
      SELECT p.id as plot_id, b.id as booking_id, b."customerId"
      FROM "Plot" p
      JOIN "Booking" b ON b."plotId" = p.id
      WHERE p."plotNumber" = 'B-05'
    `);
    console.log("Bookings for B-05:", res);
    
    if (res.length > 0) {
      const bId = res[0].booking_id;
      const insts: any = await prisma.$queryRawUnsafe(`
        SELECT id, "installmentNumber", "amount", "paidAmount", "status"
        FROM "PaymentRecord"
        WHERE "bookingId" = $1 AND "feeType" = 'plot_installment'
        ORDER BY "installmentNumber" DESC
        LIMIT 5
      `, bId);
      console.log("Last installments:", insts);
      
      const upd = await prisma.$executeRawUnsafe(`
        UPDATE "PaymentRecord"
        SET "paidAmount" = 270841, "amount" = 270841
        WHERE "bookingId" = $1 AND "installmentNumber" = 24
      `, bId);
      console.log("Updated rows:", upd);
    }
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
