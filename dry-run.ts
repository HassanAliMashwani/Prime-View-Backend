import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const installments = await prisma.paymentRecord.findMany({
    where: {
      feeType: 'plot_installment',
      status: {
        in: ['pending', 'overdue'],
      },
    },
    include: {
      booking: true,
    }
  });

  const report = [];
  
  for (const inst of installments) {
    if (!inst.dueDate) continue;
    
    const originalDate = new Date(inst.dueDate);
    let newDate = new Date(inst.dueDate);
    
    // Set to the 5th of the same month
    newDate.setDate(5);
    
    report.push({
      id: inst.id,
      bookingId: inst.bookingId,
      installmentNumber: inst.installmentNumber,
      originalDate: originalDate.toISOString().split('T')[0],
      newDate: newDate.toISOString().split('T')[0],
      status: inst.status
    });
  }

  console.log(`Found ${installments.length} pending/overdue installments to update.`);
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
