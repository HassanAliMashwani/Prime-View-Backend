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
