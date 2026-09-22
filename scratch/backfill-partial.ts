require('dotenv').config();
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DIRECT_URL } }
  });

  const records = await prisma.paymentRecord.findMany({
    where: {
      feeType: 'plot_installment',
      paidAmount: { gt: 0 }
    }
  });

  const partials = records.filter(r => r.paidAmount < r.amount && r.status !== 'partially_paid');

  console.log(`Dry-run count plot_installment with 0 < paidAmount < amount: ${partials.length}`);
  
  if (partials.length > 0) {
    const res = await prisma.paymentRecord.updateMany({
      where: {
        id: { in: partials.map(p => p.id) }
      },
      data: {
        status: 'partially_paid'
      }
    });
    console.log(`Backfilled ${res.count} rows to partially_paid`);
  }
}

main().catch(console.error).finally(() => process.exit(0));
