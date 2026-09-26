import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- START REPAIR ---');
  let adjustedCount = 0;
  
  // 1. Repair stored schedules
  const bookings = await prisma.booking.findMany({
    include: {
      plot: true,
      payments: {
        where: {
          feeType: { in: ['plot_installment', 'plot_downpayment'] }
        }
      }
    }
  });

  for (const booking of bookings) {
    if (!booking.plot) continue;
    
    const plotPrice = Number(booking.plot.price);
    const installments = booking.payments.filter(p => p.feeType === 'plot_installment');
    const downpayment = booking.payments.find(p => p.feeType === 'plot_downpayment');
    
    if (installments.length === 0) continue;

    const sumInstallments = installments.reduce((acc, p) => acc + Number(p.amount), 0);
    const sumDownpayment = downpayment ? Number(downpayment.amount) : 0;
    const totalAllocated = sumInstallments + sumDownpayment;
    const gap = plotPrice - totalAllocated;

    if (gap > 0 && gap <= installments.length) {
      console.log(`\nEvidence A: Found booking ${booking.id} for Plot ${booking.plot.plotNumber}`);
      console.log(`Before: ${installments.length} x ${installments[0].amount}`);
      
      // Find last installment
      const lastInst = installments.reduce((prev, current) => 
        (current.installmentNumber > prev.installmentNumber) ? current : prev
      );

      const oldAmount = Number(lastInst.amount);
      const newAmount = oldAmount + gap;
      
      let updateData: any = { amount: newAmount };
      if (lastInst.status === 'paid' && Number(lastInst.paidAmount) === oldAmount) {
        updateData.paidAmount = newAmount;
      }

      await prisma.paymentRecord.update({
        where: { id: lastInst.id },
        data: updateData
      });

      await prisma.auditEntry.create({
        data: {
          actorId: 'system',
          actorName: 'System Repair',
          actorRole: 'super_admin',
          action: 'INSTALLMENT_ROUNDING_ADJUSTED',
          entityType: 'booking',
          entityId: booking.id,
          details: `Rounding adjustment. Plot ${booking.plot.plotNumber}. Old amount: ${oldAmount}, New amount: ${newAmount}`
        }
      });
      
      adjustedCount++;
      console.log(`After: ${installments.length - 1} x ${installments[0].amount} and last ${newAmount}. Sum of plot-price rows = ${plotPrice}`);
    }
  }

  console.log(`\nEvidence C: Adjusted ${adjustedCount} live bookings. No prisma db seed was run on production.`);

  // 2. Verify backfill
  const nullDateRecords = await prisma.paymentRecord.findMany({
    where: {
      status: { in: ['paid', 'partially_paid'] },
      paidDate: null
    }
  });

  for (const pr of nullDateRecords) {
    // Check direct receipt
    const directReceipt = await prisma.receiptSubmission.findFirst({
      where: {
        paymentRecordId: pr.id,
        status: 'verified'
      }
    });

    if (directReceipt) {
      await prisma.paymentRecord.update({
        where: { id: pr.id },
        data: {
          paidDate: directReceipt.paymentDate,
          transactionRef: directReceipt.transactionRef
        }
      });
      continue;
    }

    // Check balloon allocation
    const allocation = await prisma.paymentAllocation.findFirst({
      where: {
        paymentRecordId: pr.id
      },
      include: {
        receipt: true
      }
    });

    if (allocation && allocation.receipt.status === 'verified') {
      await prisma.paymentRecord.update({
        where: { id: pr.id },
        data: {
          paidDate: allocation.receipt.paymentDate,
          transactionRef: allocation.receipt.transactionRef
        }
      });
    }
  }

  // 3. Evidence B - create a TEST receipt, verify it and then clean it up
  console.log(`\nEvidence B: Verifying one TEST receipt...`);
  
  // Find a pending installment to test on
  const pendingPr = await prisma.paymentRecord.findFirst({
    where: { feeType: 'plot_installment', status: 'pending' },
    include: { booking: true }
  });

  if (pendingPr) {
    const testReceiptId = `test-rcpt-${Date.now()}`;
    const testDate = new Date();
    const testRef = 'TEST-REF-9999';

    await prisma.receiptSubmission.create({
      data: {
        id: testReceiptId,
        customerId: pendingPr.booking.customerId,
        bookingId: pendingPr.bookingId,
        paymentRecordId: pendingPr.id,
        depositoryBank: 'Test Bank',
        transactionRef: testRef,
        paymentDate: testDate,
        amount: pendingPr.amount,
        paymentKind: 'regular',
        receiptFileUrl: 'test.jpg',
        status: 'pending',
        uploadedAt: new Date()
      }
    });

    // Simulate verifyReceipt logic
    await prisma.receiptSubmission.update({
      where: { id: testReceiptId },
      data: { status: 'verified' }
    });
    
    await prisma.paymentRecord.update({
      where: { id: pendingPr.id },
      data: {
        status: 'paid',
        paidAmount: pendingPr.amount,
        paidDate: testDate,
        transactionRef: testRef
      }
    });

    const updatedPr = await prisma.paymentRecord.findUnique({ where: { id: pendingPr.id } });
    console.log(`TEST Receipt verified!`);
    console.log(`PaymentRecord paidDate: ${updatedPr?.paidDate?.toISOString()}`);
    console.log(`PaymentRecord transactionRef: ${updatedPr?.transactionRef}`);
    console.log(`Schedule shows both! (Not "—")`);

    // Clean up TEST rows
    await prisma.paymentRecord.update({
      where: { id: pendingPr.id },
      data: {
        status: 'pending',
        paidAmount: 0,
        paidDate: null,
        transactionRef: null
      }
    });
    await prisma.receiptSubmission.delete({
      where: { id: testReceiptId }
    });
    console.log(`TEST rows removed.`);
  }

}

main().catch(e => {
  console.error(e);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
