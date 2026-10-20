import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { updatePlotStatus } from '../plots/update-plot-status';
import { PlotsService } from '../plots/plots.service';
import { ReservationStatus, PlotStatus } from '@prisma/client';

@Injectable()
export class ReservationsService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeService,
    private plotsService: PlotsService,
  ) {}

  private async getReservationMeta(id: string, session: any) {
    const res = await this.prisma.withScopedSession(session, async (tx) => {
      return tx.reservation.findUnique({
        where: { id },
        include: { plot: true },
      });
    });

    if (!res) {
      throw new NotFoundException({ error: 'RESERVATION_NOT_FOUND', message: 'Reservation not found' });
    }

    return res;
  }

  async findAll(session: any, query: any) {
    const page = Math.max(1, parseInt(query.page || '1', 10));
    const pageSize = 10;
    const skip = (page - 1) * pageSize;

    return this.prisma.withScopedSession(session, async (tx) => {
      const andConditions: any[] = [];
      
      if (query.status && query.status !== 'all') {
        if (query.status === 'history') {
          andConditions.push({ status: { not: 'active' } });
        } else {
          andConditions.push({ status: query.status });
        }
      }
      
      if (query.search) {
        andConditions.push({
          OR: [
            { customerName: { contains: query.search, mode: 'insensitive' } },
            { customerPhone: { contains: query.search, mode: 'insensitive' } },
            { plot: { plotNumber: { contains: query.search, mode: 'insensitive' } } },
          ],
        });
      }

      if (session.role !== 'super_admin') {
        const assignedBlocks = session.assignedBlocks || [];
        if (query.blockId && query.blockId !== 'all') {
          andConditions.push({ plot: { blockId: query.blockId } });
        } else {
          andConditions.push({ plot: { blockId: { in: assignedBlocks } } });
        }
      } else {
        if (query.blockId && query.blockId !== 'all') {
          andConditions.push({ plot: { blockId: query.blockId } });
        }
      }

      const where = andConditions.length > 0 ? { AND: andConditions } : {};

      const [items, total] = await Promise.all([
        tx.reservation.findMany({
          where,
          select: {
            id: true,
            plotId: true,
            customerName: true,
            customerPhone: true,
            customerEmail: true,
            tokenFee: true,
            validUntil: true,
            reservedByAdminId: true,
            reservedByAdminName: true,
            status: true,
            createdAt: true,
            confirmedAt: true,
            confirmedByBookingId: true,
            supersededAt: true,
            supersededByBookingId: true,
            cancelledAt: true,
            cancelledByAdminId: true,
            resolutionNote: true,
            plot: {
              select: {
                id: true,
                plotNumber: true,
                blockId: true,
                category: true,
                size: true,
                price: true,
                status: true,
                reservations: {
                  where: { status: 'active' },
                  select: { id: true },
                },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: pageSize,
        }),
        tx.reservation.count({ where }),
      ]);

      return {
        ok: true,
        items,
        total,
        page,
        pageSize,
      };
    });
  }

  async confirm(id: string, session: any) {
    const reservation = await this.getReservationMeta(id, session);

    if (reservation.status !== ReservationStatus.active) {
      throw new BadRequestException({
        error: 'INVALID_RESERVATION_STATUS',
        message: `Cannot confirm reservation in status '${reservation.status}'`,
      });
    }

    if (reservation.plot.status === PlotStatus.booked || reservation.plot.status === PlotStatus.allotted) {
      throw new ConflictException({ error: 'ALREADY_BOOKED', message: 'Plot is already booked or allotted' });
    }

    // Delegate to bookPlot with reservationId
    return this.plotsService.bookPlot(
      reservation.plotId,
      {
        customer: {
          fullName: reservation.customerName,
          phone: reservation.customerPhone,
          email: reservation.customerEmail || `${reservation.customerPhone}@primeview.org`,
        },
        paymentType: 'one_time',
        reservationId: reservation.id,
      },
      session,
    );
  }

  async release(id: string, session: any) {
    const reservation = await this.getReservationMeta(id, session);

    const isOwner = reservation.reservedByAdminId === session.adminId || reservation.reservedByAdminId === session.username;
    const isSuperAdmin = session.role === 'super_admin';

    if (!isOwner && !isSuperAdmin) {
      throw new ForbiddenException({
        error: 'NOT_RESERVATION_OWNER',
        message: 'Only the reserving admin or a Super Admin can release this reservation',
      });
    }

    const now = new Date();

    const result = await this.prisma.withScopedSession(session, async (tx) => {
      // 1. Mark reservation cancelled
      const updatedReservation = await tx.reservation.update({
        where: { id },
        data: {
          status: ReservationStatus.cancelled,
          cancelledAt: now,
          cancelledByAdminId: session.adminId || session.username,
        },
      });

      // 2. Check if other active reservations exist for this plot
      const otherActive = await tx.reservation.count({
        where: {
          plotId: reservation.plotId,
          status: ReservationStatus.active,
          id: { not: id },
        },
      });

      const currentPlot = await tx.plot.findUnique({ where: { id: reservation.plotId } });

      let updatedPlot = null;
      if (otherActive === 0 && currentPlot?.status === PlotStatus.reserved) {
        await updatePlotStatus(tx, {
          plotId: reservation.plotId,
          fromStatus: 'reserved',
          toStatus: 'available',
          changedBy: session.adminId || session.username,
          source: 'release',
          plotData: {
            lockedBy: null,
            lockedAt: null,
          }
        });
        updatedPlot = await tx.plot.findUnique({ where: { id: reservation.plotId } });
      }

      // 3. Audit entry in exact same transaction
      await tx.auditEntry.create({
        data: {
          actorId: session.adminId || session.username,
          actorName: session.fullName || session.username,
          actorRole: session.role,
          action: 'RESERVATION_RELEASED',
          entityType: 'reservation',
          entityId: id,
          details: `Reservation ${id} on plot ${reservation.plot.plotNumber} released by ${session.fullName || session.username}`,
        },
      });

      return { updatedReservation, updatedPlot };
    });

    // Realtime events
    await this.realtime.broadcast(`block:${reservation.plot.blockId}`, 'RESERVATION_UPDATED', {
      reservationId: id,
      status: 'cancelled',
    });

    if (result.updatedPlot) {
      await this.realtime.broadcast(`block:${reservation.plot.blockId}`, 'PLOT_AVAILABLE', {
        plotId: reservation.plotId,
      });
      await this.realtime.broadcast('plots', 'PLOT_AVAILABLE', {
        plotId: reservation.plotId,
      });
    }

    return { ok: true, reservation: result.updatedReservation };
  }

  async updateNote(id: string, note: string, session: any) {
    const reservation = await this.getReservationMeta(id, session);

    if (session.role !== 'super_admin' && !session.assignedBlocks?.includes(reservation.plot.blockId)) {
      throw new ForbiddenException({
        error: 'OUT_OF_SCOPE',
        message: 'You do not have access to this block',
      });
    }

    const updated = await this.prisma.withScopedSession(session, async (tx) => {
      const res = await tx.reservation.update({
        where: { id },
        data: { resolutionNote: note },
      });

      await tx.auditEntry.create({
        data: {
          actorId: session.adminId || session.username,
          actorName: session.fullName || session.username,
          actorRole: session.role,
          action: 'RESERVATION_NOTE_UPDATED',
          entityType: 'reservation',
          entityId: id,
          details: `Updated note on reservation ${id}`,
        },
      });

      return res;
    });

    return { ok: true, reservation: updated };
  }
}
