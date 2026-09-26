import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const customer = await prisma.customer.findUnique({
    where: { id: 'cust-2' },
    include: {
      bookings: {
        include: {
          payments: {
            orderBy: { installmentNumber: 'asc' }
          }
        }
      }
    }
  });

  if (!customer) {
    console.log("Customer not found.");
    return;
  }

  for (const booking of customer.bookings) {
    console.log(`Booking: ${booking.id}`);
    const installments = booking.payments.filter(p => p.feeType === 'plot_installment');
    let totalPaid = 0;
    for (const p of installments) {
       totalPaid += Number(p.paidAmount);
    }
    console.log(`Total installments: ${installments.length}, Paid amount sum: ${totalPaid}`);
    
    // Find the 24th installment
    const inst24 = installments.find(p => p.installmentNumber === 24);
    if (inst24) {
      console.log(`Installment 24: amount=${inst24.amount}, paidAmount=${inst24.paidAmount}`);
      // Adjust the 8 rupees
      if (Number(inst24.amount) > Number(inst24.paidAmount)) {
        console.log(`Adjusting paidAmount for Installment 24 from ${inst24.paidAmount} to ${inst24.amount}`);
        await prisma.paymentRecord.update({
          where: { id: inst24.id },
          data: { paidAmount: inst24.amount }
        });
        console.log("Updated.");
      }
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
