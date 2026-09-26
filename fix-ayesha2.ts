import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Connecting to Prisma...');
  const customer = await prisma.customer.findUnique({
    where: { id: 'cust-2' },
    include: { bookings: { include: { payments: { orderBy: { installmentNumber: 'asc' } } } } }
  });

  if (!customer) {
    console.log("Customer not found.");
    return;
  }

  for (const booking of customer.bookings) {
    const installments = booking.payments.filter(p => p.feeType === 'plot_installment');
    const inst24 = installments.find(p => p.installmentNumber === 24);
    if (inst24) {
      console.log(`Found Inst 24: ID=${inst24.id}, Amount=${inst24.amount}, Paid=${inst24.paidAmount}`);
      const updated = await prisma.paymentRecord.update({
        where: { id: inst24.id },
        data: { paidAmount: 270841, amount: 270841 }
      });
      console.log(`Updated Inst 24: Amount=${updated.amount}, Paid=${updated.paidAmount}`);
    }
  }
}

main()
  .then(() => console.log('Done'))
  .catch(console.error)
  .finally(() => prisma.$disconnect());
