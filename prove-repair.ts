import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- 1. Find Booking ---');
  
  // Find a booking with multiple installments, ideally 24
  const bookings = await prisma.booking.findMany({
    include: {
      plot: true,
      payments: {
        where: { feeType: 'plot_installment' },
        orderBy: { installmentNumber: 'asc' }
      }
    }
  });

  let targetBooking = bookings.find(b => b.payments.length === 24);
  if (!targetBooking) {
    targetBooking = bookings.find(b => b.payments.length > 0);
  }

  if (!targetBooking) {
    console.error('No booking with installments found!');
    return;
  }

  const booking = targetBooking;
  let installments = booking.payments;

  console.log(`Found booking ${booking.id} for Plot ${booking.plot.plotNumber} with ${installments.length} installments.`);

  const sum = installments.reduce((acc, p) => acc + Number(p.amount), 0);
  const targetSum = Number(booking.plot.price);
  console.log(`Current sum: ${sum}, Target: ${targetSum}`);

  if (sum !== targetSum && installments.length > 0) {
    console.log('Repairing...');
    const gap = targetSum - sum;
    const lastInst = installments[installments.length - 1];
    const newAmount = Number(lastInst.amount) + gap;
    
    let data: any = { amount: newAmount };
    if (lastInst.status === 'paid' && Number(lastInst.paidAmount) === Number(lastInst.amount)) {
      data.paidAmount = newAmount;
    }
    
    await prisma.paymentRecord.update({
      where: { id: lastInst.id },
      data
    });
    
    installments = await prisma.paymentRecord.findMany({
      where: { bookingId: booking.id, feeType: 'plot_installment' },
      orderBy: { installmentNumber: 'asc' }
    });
  }

  console.table(installments.map(i => ({
    installmentNumber: i.installmentNumber,
    amount: Number(i.amount),
    paidAmount: Number(i.paidAmount),
    status: i.status,
    paidDate: i.paidDate,
    transactionRef: i.transactionRef
  })));

  console.log(`New sum: ${installments.reduce((acc, p) => acc + Number(p.amount), 0)}`);

  console.log('\n--- 3. Verify one TEST receipt ---');
  const testInst = installments[0];
  const testReceiptId = `test-rcpt-${Date.now()}`;
  const testDate = new Date();
  const testRef = 'TEST-VERIFY-888';

  // Create receipt
  await prisma.receiptSubmission.create({
    data: {
      id: testReceiptId,
      customerId: booking.customerId,
      bookingId: booking.id,
      paymentRecordId: testInst.id,
      depositoryBank: 'Test Bank',
      transactionRef: testRef,
      paymentDate: testDate,
      amount: testInst.amount,
      paymentKind: 'regular',
      receiptFileUrl: 'test.jpg',
      status: 'pending',
    }
  });

  // Verify logic (similar to receipts.service.ts)
  const currentPr = await prisma.paymentRecord.findUnique({ where: { id: testInst.id } });
  if (currentPr) {
    await prisma.paymentRecord.update({
      where: { id: currentPr.id },
      data: {
        status: 'paid',
        paidAmount: testInst.amount,
        paidDate: currentPr.paidDate ?? testDate,
        transactionRef: currentPr.transactionRef ?? testRef,
      },
    });
  }

  const updatedPr = await prisma.paymentRecord.findUnique({ where: { id: testInst.id } });
  console.log('PaymentRecord after verification:');
  console.log(`paidDate: ${updatedPr?.paidDate?.toISOString()}`);
  console.log(`transactionRef: ${updatedPr?.transactionRef}`);

  // Delete test data
  await prisma.receiptSubmission.delete({ where: { id: testReceiptId } });
  // Revert test record changes
  await prisma.paymentRecord.update({
    where: { id: testInst.id },
    data: {
      paidDate: testInst.paidDate,
      transactionRef: testInst.transactionRef,
      paidAmount: testInst.paidAmount,
      status: testInst.status
    }
  });
  console.log('Test rows cleaned up.');

}

main().catch(console.error).finally(() => prisma.$disconnect());
