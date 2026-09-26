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
    where: { bookingId: 'book-2' },
    orderBy: { dueDate: 'asc' }
  });

  console.log("feeType | amount | paidAmount");
  let sum = 0;
  for (const p of payments) {
    console.log(`${p.feeType} | ${p.amount} | ${p.paidAmount}`);
    if (['plot_installment', 'plot_one_time', 'plot_downpayment'].includes(p.feeType)) {
      sum += Number(p.paidAmount);
    }
  }
  console.log("Total plot paid:", sum);
}

main().catch(console.error).finally(() => prisma.$disconnect());
