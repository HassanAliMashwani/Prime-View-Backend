import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "postgresql://postgres.nnuyccntmxhrkbbsnmwn:primeview.124@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
    }
  }
});

async function main() {
  const payments = await prisma.paymentRecord.findMany({
    where: { bookingId: 'book-2', feeType: 'plot_installment' },
    orderBy: { installmentNumber: 'asc' }
  });

  console.log("installmentNumber | amount | paidAmount | status | paidDate | transactionRef");
  for (const p of payments) {
    console.log(`${p.installmentNumber} | ${p.amount} | ${p.paidAmount} | ${p.status} | ${p.paidDate} | ${p.transactionRef}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
