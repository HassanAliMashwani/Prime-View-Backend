import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

export interface SweepStatus {
  isRunning: boolean;
  totalSweepsRun: number;
  lastSweepTime: string | null;
  totalPlotLocksCleared: number;
  totalContentLocksCleared: number;
  totalReservationsExpired: number;
  intervalMs: number;
}

@Injectable()
export class SweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SweepService.name);
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private totalSweepsRun = 0;
  private lastSweepTime: Date | null = null;
  private totalPlotLocksCleared = 0;
  private totalContentLocksCleared = 0;
  private totalReservationsExpired = 0;
  private readonly intervalMs = 5000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async onModuleInit() {
    this.logger.log('Starting autonomous SweepService...');
    // 1. Run immediately on module initialization / server boot
    try {
      await this.runSweep();
    } catch (err) {
      this.logger.error(`Startup sweep failed: ${err.message}`, err.stack);
    }

    // 2. Schedule autonomous ticker every 5 seconds
    this.timer = setInterval(async () => {
      try {
        await this.runSweep();
      } catch (err) {
        this.logger.error(`Autonomous sweep cycle failed: ${err.message}`, err.stack);
      }
    }, this.intervalMs);

    this.logger.log(`Autonomous SweepService scheduled every ${this.intervalMs}ms`);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.log('SweepService stopped.');
    }
  }

  async runSweep(): Promise<{
    clearedPlotLocks: number;
    clearedContentLocks: number;
    expiredReservations: number;
  }> {
    if (this.isRunning) {
      return { clearedPlotLocks: 0, clearedContentLocks: 0, expiredReservations: 0 };
    }

    this.isRunning = true;
    const now = new Date();
    const plotLockExpiryThreshold = new Date(now.getTime() - 10 * 60 * 1000); // 10 minutes
    const contentLockExpiryThreshold = new Date(now.getTime() - 30 * 60 * 1000); // 30 minutes

    let clearedPlotLocks = 0;
    let clearedContentLocks = 0;
    let expiredReservations = 0;

    try {
      await this.prisma.withScopedSession({ role: 'super_admin' }, async (tx) => {
        // ── 1. Expire Plot Locks (> 10 minutes) ──
        const expiredPlots = await tx.plot.findMany({
          where: {
            lockedBy: { not: null },
            lockedAt: { lt: plotLockExpiryThreshold },
          },
        });

        for (const plot of expiredPlots) {
          await tx.plot.update({
            where: { id: plot.id },
            data: {
              lockedBy: null,
              lockedAt: null,
            },
          });

          await tx.auditEntry.create({
            data: {
              actorId: 'system',
              actorName: 'System Background Worker',
              actorRole: 'system',
              action: 'PLOT_LOCK_EXPIRED',
              entityType: 'Plot',
              entityId: plot.id,
              details: JSON.stringify({
                reason: 'Plot lock exceeded 10-minute validity threshold',
                plotNumber: plot.plotNumber,
                blockId: plot.blockId,
                previousLockedBy: plot.lockedBy,
                lockedAt: plot.lockedAt,
              }),
              oldValue: { lockedBy: plot.lockedBy, lockedAt: plot.lockedAt },
              newValue: { lockedBy: null, lockedAt: null },
            },
          });

          // Dispatched Realtime Broadcast
          await this.realtime.broadcast('plots', 'PLOT_UNLOCKED', {
            plotId: plot.id,
            blockId: plot.blockId,
            plotNumber: plot.plotNumber,
            reason: 'LOCK_EXPIRED',
            unlockedAt: now.toISOString(),
          });

          await this.realtime.broadcast(`block:${plot.blockId}`, 'PLOT_UNLOCKED', {
            plotId: plot.id,
            blockId: plot.blockId,
            plotNumber: plot.plotNumber,
            reason: 'LOCK_EXPIRED',
            unlockedAt: now.toISOString(),
          });

          clearedPlotLocks++;
          this.logger.log(`[SWEEP] Cleared expired plot lock for Plot ${plot.plotNumber} (${plot.blockId})`);
        }

        // ── 2. Expire Content CMS Locks (> 30 minutes) ──
        const expiredContent = await tx.contentBlock.findMany({
          where: {
            lockedBy: { not: null },
            lockedAt: { lt: contentLockExpiryThreshold },
          },
        });

        for (const block of expiredContent) {
          await tx.contentBlock.update({
            where: { id: block.id },
            data: {
              lockedBy: null,
              lockedAt: null,
            },
          });

          await tx.auditEntry.create({
            data: {
              actorId: 'system',
              actorName: 'System Background Worker',
              actorRole: 'system',
              action: 'CONTENT_LOCK_EXPIRED',
              entityType: 'ContentBlock',
              entityId: block.id,
              details: JSON.stringify({
                reason: 'Content block lock exceeded 30-minute validity threshold',
                section: block.section,
                title: block.title,
                previousLockedBy: block.lockedBy,
                lockedAt: block.lockedAt,
              }),
              oldValue: { lockedBy: block.lockedBy, lockedAt: block.lockedAt },
              newValue: { lockedBy: null, lockedAt: null },
            },
          });

          // Dispatched Realtime Broadcast
          await this.realtime.broadcast('content', 'CONTENT_UNLOCKED', {
            blockId: block.id,
            section: block.section,
            title: block.title,
            reason: 'LOCK_EXPIRED',
            unlockedAt: now.toISOString(),
          });

          clearedContentLocks++;
          this.logger.log(`[SWEEP] Cleared expired content lock for ${block.title} (${block.section})`);
        }

        // ── 3. Expire Active Reservations (validUntil < NOW) ──
        const expiredResList = await tx.reservation.findMany({
          where: {
            status: 'active',
            validUntil: { lt: now },
          },
          include: {
            plot: true,
          },
        });

        for (const res of expiredResList) {
          await tx.reservation.update({
            where: { id: res.id },
            data: { status: 'expired' },
          });

          await tx.auditEntry.create({
            data: {
              actorId: 'system',
              actorName: 'System Background Worker',
              actorRole: 'system',
              action: 'RESERVATION_EXPIRED',
              entityType: 'Reservation',
              entityId: res.id,
              details: JSON.stringify({
                reason: 'Reservation validity window expired',
                plotId: res.plotId,
                customerName: res.customerName,
                validUntil: res.validUntil,
              }),
              oldValue: { status: 'active', validUntil: res.validUntil },
              newValue: { status: 'expired' },
            },
          });

          // If plot is unbooked and no other active reservations, restore to available
          const otherActiveRes = await tx.reservation.count({
            where: {
              plotId: res.plotId,
              status: 'active',
              validUntil: { gte: now },
            },
          });

          const isBooked = await tx.booking.count({
            where: {
              plotId: res.plotId,
              status: 'active',
            },
          });

          const currentPlot = await tx.plot.findUnique({
            where: { id: res.plotId },
          });

          if (currentPlot && currentPlot.status !== 'booked' && otherActiveRes === 0 && isBooked === 0) {
            await tx.plot.update({
              where: { id: res.plotId },
              data: { status: 'available' },
            });

            await this.realtime.broadcast('plots', 'PLOT_STATUS_CHANGED', {
              plotId: res.plotId,
              status: 'available',
              reason: 'RESERVATION_EXPIRED',
            });

            await this.realtime.broadcast(`block:${currentPlot.blockId}`, 'PLOT_AVAILABLE', {
              plotId: res.plotId,
              status: 'available',
              reason: 'RESERVATION_EXPIRED',
            });
          }


          await this.realtime.broadcast('reservations', 'RESERVATION_EXPIRED', {
            reservationId: res.id,
            plotId: res.plotId,
            customerName: res.customerName,
            expiredAt: now.toISOString(),
          });

          expiredReservations++;
          this.logger.log(`[SWEEP] Expired reservation ${res.id} for plot ${res.plotId}`);
        }
      });

      this.totalPlotLocksCleared += clearedPlotLocks;
      this.totalContentLocksCleared += clearedContentLocks;
      this.totalReservationsExpired += expiredReservations;
      this.lastSweepTime = now;
      this.totalSweepsRun++;
    } catch (error) {
      this.logger.error(`Sweep execution encountered error: ${error.message}`, error.stack);
      throw error;
    } finally {
      this.isRunning = false;
    }

    return { clearedPlotLocks, clearedContentLocks, expiredReservations };
  }

  getStatus(): SweepStatus {
    return {
      isRunning: this.isRunning,
      totalSweepsRun: this.totalSweepsRun,
      lastSweepTime: this.lastSweepTime ? this.lastSweepTime.toISOString() : null,
      totalPlotLocksCleared: this.totalPlotLocksCleared,
      totalContentLocksCleared: this.totalContentLocksCleared,
      totalReservationsExpired: this.totalReservationsExpired,
      intervalMs: this.intervalMs,
    };
  }
}
