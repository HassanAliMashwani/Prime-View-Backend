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
 * P3-ALLOT-LAST: Promotes a plot from 'booked' to 'allotted' if and only if
 * all PaymentRecords on that booking (statutory fees, downpayment, and installments)
 * are fully paid (status === 'paid' && paidAmount >= amount).
 *
 * Uses updatePlotStatus with concurrency guard and PlotStatusHistory row creation.
 */
export async function maybeAllotIfFullyPaid(
  tx: Prisma.TransactionClient,
  bookingId: string,
  changedBy: string = 'system',
): Promise<boolean> {
  // 1. Load all PaymentRecords for bookingId
  const payments = await tx.paymentRecord.findMany({
    where: { bookingId },
  });

  if (payments.length === 0) {
    return false;
  }

  // 2. If any paidAmount < amount (or status not paid) -> return false
  const allPaid = payments.every(
    (p) => p.status === 'paid' && Number(p.paidAmount) >= Number(p.amount),
  );
  if (!allPaid) {
    return false;
  }

  // 3. Load booking + plot. If paymentType is one_time and already allotted, no-op.
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    include: { plot: true },
  });

  if (!booking || !booking.plot) {
    return false;
  }

  if (booking.paymentType === 'one_time' && booking.plot.status === PlotStatus.allotted) {
    return false;
  }

  // 4. If plot.status !== 'booked' -> return false
  if (booking.plot.status !== PlotStatus.booked) {
    return false;
  }

  // 5. updatePlotStatus(plotId, booked -> allotted) + PlotStatusHistory
  await updatePlotStatus(tx, {
    plotId: booking.plot.id,
    fromStatus: PlotStatus.booked,
    toStatus: PlotStatus.allotted,
    changedBy,
    source: 'auto_allot_fully_paid',
    reason: `All ${payments.length} payment records fully settled on booking ${bookingId}`,
  });

  // 6. Return true
  return true;
}
