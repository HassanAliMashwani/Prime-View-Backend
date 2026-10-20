import { Prisma, PlotStatus } from '@prisma/client';
import { ConflictException } from '@nestjs/common';

export async function updatePlotStatus(
  tx: Prisma.TransactionClient,
  args: {
    plotId: string;
    fromStatus: PlotStatus | null; // null for initial backfill, though helper isn't used for backfill
    toStatus: PlotStatus;
    changedBy: string;
    reason?: string;
    source: string;
    plotData?: Partial<Prisma.PlotUncheckedUpdateInput>;
  }
): Promise<void> {
  const { plotId, fromStatus, toStatus, changedBy, reason, source, plotData } = args;

  // We only use this helper for live status transitions where fromStatus is known.
  if (!fromStatus) {
    throw new Error('updatePlotStatus requires fromStatus for live transitions.');
  }

  // 1. Concurrency guard using updateMany
  const updateResult = await tx.plot.updateMany({
    where: { 
      id: plotId, 
      status: fromStatus 
    },
    data: {
      status: toStatus,
      ...plotData,
    },
  });

  if (updateResult.count === 0) {
    throw new ConflictException({
      error: 'PLOT_STATUS_CONFLICT',
      message: `Plot state changed concurrently or is not in the expected status (${fromStatus}). Cannot transition to ${toStatus}.`,
    });
  }

  // 2. Insert history row
  await tx.plotStatusHistory.create({
    data: {
      plotId,
      fromStatus,
      toStatus,
      changedBy,
      reason,
      source,
    },
  });
}

/**
 * P3-ALLOT-LAST: Promotes a plot from 'booked' to 'allotted' when possession is fully paid (installment),
 * or when one-time payment is settled.
 *
 * Uses updatePlotStatus with concurrency guard and PlotStatusHistory row creation.
 */
export async function maybeAllotIfFullyPaid(
  tx: Prisma.TransactionClient,
  bookingId: string,
  changedBy: string = 'system',
): Promise<boolean> {
  // 1. Load the booking with its plot
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    include: { plot: true },
  });

  if (!booking || !booking.plot) {
    return false;
  }

  // 2. One-time payment (paymentType one_time): keep today's behavior.
  // Those bookings are already set to allotted in customers.service.ts when the plot_one_time row is created as paid.
  // maybeAllotIfFullyPaid must not demote them and must not require a possession row.
  // If the plot is already allotted, return false.
  // If a one_time plot is still booked and its plot_one_time row is paid with paidAmount >= amount, promote it to allotted with source auto_allot_fully_paid.
  if (booking.paymentType === 'one_time') {
    if (booking.plot.status === PlotStatus.allotted) {
      return false;
    }
    if (booking.plot.status !== PlotStatus.booked) {
      return false;
    }

    const oneTimeRecord = await tx.paymentRecord.findFirst({
      where: {
        bookingId,
        feeType: 'plot_one_time',
      },
    });

    if (
      !oneTimeRecord ||
      oneTimeRecord.status !== 'paid' ||
      Number(oneTimeRecord.paidAmount) < Number(oneTimeRecord.amount)
    ) {
      return false;
    }

    await updatePlotStatus(tx, {
      plotId: booking.plot.id,
      fromStatus: PlotStatus.booked,
      toStatus: PlotStatus.allotted,
      changedBy,
      source: 'auto_allot_fully_paid',
      reason: `All installment and possession payments fully settled on booking ${bookingId}`,
    });

    return true;
  }

  // 3. Installment payment: load every PaymentRecord on that booking whose feeType is
  // plot_downpayment, plot_installment, plot_biannual, or plot_possession
  const installmentRecords = await tx.paymentRecord.findMany({
    where: {
      bookingId,
      feeType: {
        in: ['plot_downpayment', 'plot_installment', 'plot_biannual', 'plot_possession'],
      },
    },
  });

  if (installmentRecords.length === 0) {
    return false;
  }

  // There must be at least one plot_possession row
  const hasPossession = installmentRecords.some((r) => r.feeType === 'plot_possession');
  if (!hasPossession) {
    return false;
  }

  // Every one of those rows must have status paid and paidAmount >= amount
  const allPaid = installmentRecords.every(
    (r) => r.status === 'paid' && Number(r.paidAmount) >= Number(r.amount),
  );
  if (!allPaid) {
    return false;
  }

  // Plot status must be booked
  if (booking.plot.status !== PlotStatus.booked) {
    return false;
  }

  // Call updatePlotStatus from booked to allotted
  await updatePlotStatus(tx, {
    plotId: booking.plot.id,
    fromStatus: PlotStatus.booked,
    toStatus: PlotStatus.allotted,
    changedBy,
    source: 'auto_allot_fully_paid',
    reason: `All installment and possession payments fully settled on booking ${bookingId}`,
  });

  return true;
}
