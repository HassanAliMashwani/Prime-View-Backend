import {
  Injectable,
  Logger,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { updatePlotStatus, maybeAllotIfFullyPaid } from './update-plot-status';
import { ReservePlotDto } from './dto/reserve-plot.dto';
import { BookPlotDto } from './dto/book-plot.dto';
import { TogglePlotAdjustmentDto } from './dto/toggle-adjustment.dto';
import { UpdatePlotPriceDto } from './dto/update-plot-price.dto';
import { GeneratedDocType, PaymentType, FeeType, PaymentStatus, ReservationStatus, PlotStatus, Prisma } from '@prisma/client';

import { attachDisplayStatus } from './display-status';
import { calculateInstallmentDueDates } from '../common/installment-dates';
import { generateFixedSchedule } from '../common/schedule-calculator';

@Injectable()
export class PlotsService {
  private readonly logger = new Logger(PlotsService.name);

  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeService,
  ) {}

  async findAll(blockId: string, session: any, search?: string) {
    if (!blockId && (!search || search.length < 2)) {
      return [];
    }

    let whereClause: any = {};
    if (blockId && blockId !== 'all') {
      whereClause.blockId = blockId;
    } else if (session.role !== 'super_admin') {
      whereClause.blockId = { in: session.assignedBlocks || [] };
    }

    if (search) {
      whereClause.plotNumber = { contains: search, mode: 'insensitive' };
      whereClause.category = { not: 'amenity' };
      whereClause.status = 'available';
    }

    return this.prisma.withScopedSession(session, async (tx) => {
      const plots = await tx.plot.findMany({
        where: whereClause,
        take: search ? 20 : undefined,
        include: {
          reservations: true,
          bookings: {
            select: {
              id: true,
              plotId: true,
              customerId: true,
              paymentType: true,
              status: true,
              bookingDate: true,
            },
          },
          currentOwner: {
            select: {
              id: true,
              fullName: true,
              phone: true,
              email: true,
              cnic: true,
              city: true,
              mailingAddress: true,
              membershipNo: true,
              registrationStatus: true,
              accountStatus: true,
            },
          },
        },
      });

      const lockedByIds = [...new Set(plots.map((p) => p.lockedBy).filter(Boolean))] as string[];
      let adminMap = new Map<string, { fullName: string; username: string }>();
      if (lockedByIds.length > 0) {
        const admins = await tx.adminUser.findMany({
          where: { id: { in: lockedByIds } },
          select: { id: true, fullName: true, username: true },
        });
        admins.forEach((a) => adminMap.set(a.id, a));
      }

      return plots.map((p) => {
        const withStatus = attachDisplayStatus(p);
        let lockedByName: string | null = null;
        if (p.lockedBy) {
          const admin = adminMap.get(p.lockedBy);
          lockedByName = admin ? (admin.fullName || admin.username) : null;
        }
        return {
          ...withStatus,
          lockedByName,
        };
      });
    });
  }

  /**
   * Fast lightweight sync: return only active locks and status for plots in a block.
   * Avoids scanning full rows, geometries, relations, etc.
   */
  async getBlockLocks(blockId: string, session: any) {
    if (session.role !== 'super_admin' && !session.assignedBlocks?.includes(blockId)) {
      throw new ForbiddenException({
        error: 'OUT_OF_SCOPE',
        message: 'You do not have access to this block',
      });
    }

    const now = new Date();
    const lockExpiryWindowMs = 10 * 60 * 1000;
    const expiryThreshold = new Date(now.getTime() - lockExpiryWindowMs);

    return this.prisma.withScopedSession(session, async (tx) => {
      const plots = await tx.plot.findMany({
        where: { blockId },
        select: {
          id: true,
          status: true,
          lockedBy: true,
          lockedAt: true,
          isAdjustment: true,
        },
      });

      const activeLockedByIds = [
        ...new Set(
          plots
            .filter((p) => p.lockedBy && p.lockedAt && p.lockedAt >= expiryThreshold)
            .map((p) => p.lockedBy)
            .filter(Boolean)
        ),
      ] as string[];

      let adminMap = new Map<string, string>();
      if (activeLockedByIds.length > 0) {
        const admins = await tx.adminUser.findMany({
          where: { id: { in: activeLockedByIds } },
          select: { id: true, fullName: true, username: true },
        });
        admins.forEach((a) => adminMap.set(a.id, a.fullName || a.username));
      }

      return plots.map((p) => {
        const isLockActive = Boolean(p.lockedBy && p.lockedAt && p.lockedAt >= expiryThreshold);
        const lockedBy = isLockActive ? p.lockedBy : null;
        const lockedByName = lockedBy ? (adminMap.get(lockedBy) || 'Admin') : null;
        const lockedAt = isLockActive && p.lockedAt ? p.lockedAt.toISOString() : null;

        return {
          id: p.id,
          status: p.status,
          isAdjustment: p.isAdjustment,
          lockedBy,
          lockedByName,
          lockedAt,
        };
      });
    });
  }

  private async getPlotWithScopeCheck(plotId: string, session: any) {
    const plotMeta = await this.prisma.withScopedSession(session, async (tx) => {
      return tx.plot.findUnique({ where: { id: plotId } });
    });

    if (!plotMeta) {
      throw new NotFoundException({ error: 'PLOT_NOT_FOUND', reason: 'PLOT_NOT_FOUND', message: 'Plot not found' });
    }

    if (session.role !== 'super_admin' && !session.assignedBlocks?.includes(plotMeta.blockId)) {
      throw new ForbiddenException({
        error: 'OUT_OF_SCOPE',
        reason: 'OUT_OF_SCOPE',
        message: 'You do not have access to this block',
      });
    }

    return plotMeta;
  }

  async findOne(id: string, session: any) {
    return this.prisma.withScopedSession(session, async (tx) => {
      const plot = await tx.plot.findUnique({
        where: { id },
        include: {
          reservations: true,
          bookings: {
            select: {
              id: true,
              plotId: true,
              customerId: true,
              paymentType: true,
              status: true,
              bookingDate: true,
            },
          },
          currentOwner: {
            select: {
              id: true,
              fullName: true,
              phone: true,
              email: true,
              cnic: true,
              city: true,
              mailingAddress: true,
              membershipNo: true,
              registrationStatus: true,
              accountStatus: true,
            },
          },
        },
      });

      if (!plot) {
        throw new NotFoundException({ error: 'PLOT_NOT_FOUND', reason: 'PLOT_NOT_FOUND', message: 'Plot not found' });
      }

      if (session.role !== 'super_admin' && !session.assignedBlocks?.includes(plot.blockId)) {
        throw new ForbiddenException({
          error: 'OUT_OF_SCOPE',
          reason: 'OUT_OF_SCOPE',
          message: 'You do not have access to this block',
        });
      }

      let lockedByName: string | null = null;
      if (plot.lockedBy) {
        const admin = await tx.adminUser.findUnique({
          where: { id: plot.lockedBy },
          select: { fullName: true, username: true },
        });
        lockedByName = admin ? (admin.fullName || admin.username) : null;
      }

      return {
        ...attachDisplayStatus(plot),
        lockedByName,
      };
    });
  }

  /**
   * Acquire a 10-minute soft lock on a plot (Layer 1 Soft Lock)
   */
  async acquireLock(plotId: string, session: any) {
    if (session.role !== 'super_admin' && !session.permissions?.can_reserve && !session.permissions?.can_book) {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'You do not have permission to lock plots for booking or reservation',
      });
    }

    await this.getPlotWithScopeCheck(plotId, session);

    const now = new Date();
    const lockExpiryWindowMs = 10 * 60 * 1000;

    const result = await this.prisma.withScopedSession(session, async (tx) => {
      const expiryThreshold = new Date(now.getTime() - lockExpiryWindowMs);
      const updateResult = await tx.plot.updateMany({
        where: {
          id: plotId,
          isAdjustment: false,
          category: { not: 'amenity' },
          status: { notIn: [PlotStatus.booked, PlotStatus.allotted, PlotStatus.disputed] },
          OR: [
            { lockedBy: null },
            { lockedBy: session.adminId },
            { lockedAt: null },
            { lockedAt: { lt: expiryThreshold } },
          ],
        },
        data: {
          lockedBy: session.adminId,
          lockedAt: now,
        },
      });

      if (updateResult.count === 0) {
        // Query current state to determine failure reason
        const currentPlot = await tx.plot.findUnique({ where: { id: plotId } });
        if (!currentPlot) {
          throw new NotFoundException({ error: 'PLOT_NOT_FOUND', message: 'Plot not found' });
        }
        if (currentPlot.isAdjustment) {
          throw new BadRequestException({
            error: 'PLOT_UNDER_ADJUSTMENT',
            message: 'Plot is currently under Town Planning adjustment',
          });
        }
        if (currentPlot.category === 'amenity') {
          throw new BadRequestException({
            error: 'AMENITY_NOT_SELLABLE',
            message: 'Amenity plots cannot be locked, reserved or booked',
          });
        }
        if (currentPlot.status === PlotStatus.booked || currentPlot.status === PlotStatus.allotted || currentPlot.status === PlotStatus.disputed) {
          throw new ConflictException({
            error: 'PLOT_NOT_AVAILABLE',
            message: `Plot is ${currentPlot.status} and cannot be locked`,
          });
        }

        let lockedByName = 'Another Administrator';
        if (currentPlot.lockedBy) {
          const lockingAdmin = await tx.adminUser.findUnique({
            where: { id: currentPlot.lockedBy },
            select: { fullName: true, username: true },
          });
          if (lockingAdmin) {
            lockedByName = lockingAdmin.fullName || lockingAdmin.username;
          }
        }

        throw new ConflictException({
          error: 'LOCKED_BY_ANOTHER',
          message: `Plot is currently locked by ${lockedByName}`,
          lockedBy: currentPlot.lockedBy,
          lockedByName,
          lockedAt: currentPlot.lockedAt,
        });
      }

      const updatedPlot = (await tx.plot.findUnique({ where: { id: plotId } }))!;

      const audit = await tx.auditEntry.create({
        data: {
          actorId: session.adminId || session.username,
          actorName: session.fullName || session.username,
          actorRole: session.role,
          action: 'PLOT_LOCK_ACQUIRED',
          entityType: 'lock',
          entityId: plotId,
          details: `Admin ${session.fullName || session.username} acquired 10m booking lock on ${updatedPlot.plotNumber}`,
          newValue: { lockedBy: session.adminId, lockedAt: now },
        },
      });

      return { updatedPlot, audit };
    });

    const lockToken = `lock-${plotId}-${session.adminId}-${now.getTime()}`;

    // Publish Supabase Realtime broadcast
    await this.realtime.broadcast(`block:${result.updatedPlot.blockId}`, 'PLOT_LOCKED', {
      plotId,
      lockedBy: session.adminId,
      lockedByName: session.fullName || session.username,
      lockedAt: now.getTime(),
    });
    await this.realtime.broadcast('plots', 'PLOT_LOCKED', {
      plotId,
      lockedBy: session.adminId,
      lockedByName: session.fullName || session.username,
      lockedAt: now.getTime(),
    });

    return {
      ok: true,
      plot: {
        ...result.updatedPlot,
        lockedByName: session.fullName || session.username,
      },
      lockToken,
    };
  }

  /**
   * Release an acquired soft lock manually
   */
  async releaseLock(plotId: string, session: any) {
    await this.getPlotWithScopeCheck(plotId, session);

    const result = await this.prisma.withScopedSession(session, async (tx) => {
      const plot = await tx.plot.findUnique({ where: { id: plotId } });
      if (!plot) {
        throw new NotFoundException({ error: 'PLOT_NOT_FOUND', message: 'Plot not found' });
      }

      if (plot.lockedBy !== session.adminId && session.role !== 'super_admin') {
        throw new ForbiddenException({
          error: 'UNAUTHORIZED_RELEASE',
          message: 'Only the lock holder or a Super Admin can release this lock',
        });
      }

      const updatedPlot = await tx.plot.update({
        where: { id: plotId },
        data: {
          lockedBy: null,
          lockedAt: null,
        },
      });

      await tx.auditEntry.create({
        data: {
          actorId: session.adminId || session.username,
          actorName: session.fullName || session.username,
          actorRole: session.role,
          action: 'PLOT_LOCK_RELEASED',
          entityType: 'lock',
          entityId: plotId,
          details: `Lock released on ${plot.plotNumber}`,
        },
      });

      return updatedPlot;
    });

    await this.realtime.broadcast(`block:${result.blockId}`, 'PLOT_UNLOCKED', {
      plotId,
      reason: 'MANUAL_RELEASE',
    });
    await this.realtime.broadcast('plots', 'PLOT_UNLOCKED', {
      plotId,
      reason: 'MANUAL_RELEASE',
    });

    return { ok: true };
  }

  /**
   * Reserve a plot with an admin-specified token fee (Layer 1 Soft Reservation)
   */
  async reservePlot(plotId: string, dto: ReservePlotDto, session: any) {
    if (session.role !== 'super_admin' && !session.permissions?.can_reserve) {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'You do not have permission to reserve plots',
      });
    }

    await this.getPlotWithScopeCheck(plotId, session);

    const now = new Date();
    const lockExpiryWindowMs = 10 * 60 * 1000;
    // P2-02: Default hold duration is 24 hours (1 day)
    const validHours = dto.validHours ?? (dto.validDays ? dto.validDays * 24 : 24);
    const validUntil = new Date(now.getTime() + validHours * 60 * 60 * 1000);

    const result = await this.prisma.withScopedSession(session, async (tx) => {
      // 1. Concurrency Gate: Acquire row lock on plot
      const plots: any[] = await tx.$queryRaw`SELECT * FROM "Plot" WHERE id = ${plotId} FOR UPDATE`;
      const plot = plots[0];
      if (!plot) {
        throw new NotFoundException({ error: 'PLOT_NOT_FOUND', reason: 'PLOT_NOT_FOUND', message: 'Plot not found' });
      }

      if (plot.isAdjustment) {
        throw new BadRequestException({
          error: 'PLOT_UNDER_ADJUSTMENT',
          message: 'Plot is currently under Town Planning adjustment',
        });
      }

      if (plot.category === 'amenity') {
        throw new BadRequestException({
          error: 'AMENITY_NOT_SELLABLE',
          message: 'Amenity plots cannot be reserved or booked',
        });
      }

      if (plot.status !== PlotStatus.available) {
        throw new ConflictException({
          error: 'PLOT_NOT_AVAILABLE',
          reason: 'PLOT_NOT_AVAILABLE',
          message: `Plot is ${plot.status} and cannot be reserved`,
        });
      }

      // Enforce one person: check if any active reservation exists
      const existingRes = await tx.reservation.findFirst({
        where: {
          plotId: plot.id,
          status: ReservationStatus.active,
          validUntil: { gt: now },
        },
      });
      if (existingRes) {
        throw new ConflictException({
          error: 'ALREADY_RESERVED',
          message: 'Plot already has an active reservation',
        });
      }

      const phoneDigits = dto.customerPhone.replace(/\D/g, '');
      if (phoneDigits.length > 11) {
        throw new BadRequestException({
          error: 'INVALID_PHONE',
          message: 'Customer phone number cannot be greater than 11 digits.',
        });
      }

      if (dto.tokenFee !== undefined && (isNaN(Number(dto.tokenFee)) || Number(dto.tokenFee) <= 0)) {
        throw new BadRequestException({
          error: 'INVALID_TOKEN_FEE',
          message: 'Token fee must be greater than zero.',
        });
      }

      // Check if any live non-void booking exists
      const existingBooking = await tx.booking.findFirst({
        where: {
          plotId: plot.id,
          status: { not: 'void' },
        },
      });
      if (existingBooking) {
        throw new ConflictException({
          error: 'ALREADY_BOOKED',
          message: 'Plot already has a live booking',
        });
      }

      // Check if locked by another admin
      if (plot.lockedBy && plot.lockedBy !== session.adminId) {
        const lockedAtDate = plot.lockedAt ? new Date(plot.lockedAt) : null;
        if (lockedAtDate && now.getTime() - lockedAtDate.getTime() <= lockExpiryWindowMs) {
          throw new ConflictException({
            error: 'LOCKED_BY_ANOTHER',
            message: 'Plot is currently locked by another admin',
          });
        }
      }

      // 2. Conditional update on plot: guard against booked status
      await updatePlotStatus(tx, {
        plotId,
        fromStatus: plot.status,
        toStatus: PlotStatus.reserved,
        changedBy: session.adminId || session.username,
        source: 'reserve',
        plotData: {
          lockedBy: null,
          lockedAt: null,
        },
      });

      const updatedPlot = {
        ...plot,
        status: PlotStatus.reserved,
        lockedBy: null,
        lockedAt: null,
      };

      // 3. Create Reservation record (allows multi-reservation queue per Doc 02 §4)
      const reservationId = `res-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const reservation = await tx.reservation.create({
        data: {
          id: reservationId,
          plotId: plot.id,
          customerName: dto.customerName.trim(),
          customerPhone: dto.customerPhone.trim(),
          customerEmail: dto.customerEmail?.trim() || null,
          tokenFee: dto.tokenFee || 50000,
          validUntil,
          reservedByAdminId: session.adminId || session.username,
          reservedByAdminName: session.fullName || session.username,
          status: ReservationStatus.active,
          resolutionNote: dto.note?.trim() || null,
          customerId: dto.customerId || null,
        },
      });

      // 4. Audit entry in exact same transaction
      await tx.auditEntry.create({
        data: {
          actorId: session.adminId || session.username,
          actorName: session.fullName || session.username,
          actorRole: session.role,
          action: 'PLOT_RESERVED',
          entityType: 'reservation',
          entityId: reservation.id,
          details: `Plot ${plot.plotNumber} reserved for ${reservation.customerName} (Token: PKR ${reservation.tokenFee.toLocaleString()})`,
        },
      });

      return { updatedPlot, reservation };
    });

    await this.realtime.broadcast(`block:${result.updatedPlot.blockId}`, 'PLOT_RESERVED', {
      plotId: result.updatedPlot.id,
      reservationId: result.reservation.id,
    });
    await this.realtime.broadcast('plots', 'PLOT_RESERVED', {
      plotId: result.updatedPlot.id,
      reservationId: result.reservation.id,
    });

    return {
      ok: true,
      reservation: result.reservation,
      plot: result.updatedPlot,
    };
  }

  /**
   * Commit a Booking (Layer 2 Atomic Commit Guard)
   * Single-transaction commit for Plot status, Booking, PaymentRecords, SocietyDocuments, Reservations, AuditEntry.
   */
  async bookPlot(plotId: string, dto: BookPlotDto, session: any) {
    const t0 = Date.now();
    if (session.role !== 'super_admin') {
      if (!session.permissions?.can_book) {
        throw new ForbiddenException({
          error: 'FORBIDDEN',
          message: 'You do not have permission to book plots',
        });
      }

      await this.getPlotWithScopeCheck(plotId, session);
    }

    const now = new Date();
    const lockExpiryWindowMs = 10 * 60 * 1000;

    const result = await this.prisma.withScopedSession(session, async (tx) => {
      const tTxStart = Date.now();

      // 1. Concurrency Gate & Scope Check: Acquire row lock and fetch plot in 1 single roundtrip
      const plots: any[] = await tx.$queryRaw`SELECT * FROM "Plot" WHERE id = ${plotId} FOR UPDATE`;
      const plot = plots[0];
      if (!plot) {
        throw new NotFoundException({ error: 'PLOT_NOT_FOUND', reason: 'PLOT_NOT_FOUND', message: 'Plot not found' });
      }

      // Check 2: Scope check - Verify admin has authority over the block
      if (session.role !== 'super_admin' && !session.assignedBlocks?.includes(plot.blockId)) {
        throw new ForbiddenException({
          error: 'OUT_OF_SCOPE',
          reason: 'OUT_OF_SCOPE',
          message: 'You do not have access to this block',
        });
      }

      if (plot.isAdjustment) {
        throw new BadRequestException({
          error: 'PLOT_UNDER_ADJUSTMENT',
          message: 'Plot is currently under Town Planning adjustment',
        });
      }

      if (plot.category === 'amenity') {
        throw new BadRequestException({
          error: 'AMENITY_NOT_SELLABLE',
          message: 'Amenity plots cannot be reserved or booked',
        });
      }

      if (plot.status === PlotStatus.booked || plot.status === PlotStatus.allotted) {
        throw new ConflictException({
          error: 'ALREADY_BOOKED',
          message: 'Plot is already booked or allotted',
        });
      }

      // Lock-ownership re-check (Exception 5.1 / Doc 10)
      if (plot.lockedBy && plot.lockedBy !== session.adminId) {
        const lockedAtDate = plot.lockedAt ? new Date(plot.lockedAt) : null;
        if (lockedAtDate && now.getTime() - lockedAtDate.getTime() <= lockExpiryWindowMs) {
          throw new ConflictException({
            error: 'LOCK_LOST',
            message: 'Plot lock has expired or belongs to another admin',
          });
        }
      }

      // 2. Resolve Customer inside tx (only reached if plot is valid, in-scope, and bookable)
      let customer: any = null;
      if (dto.customerId) {
        customer = await this.prisma.customer.findUnique({ where: { id: dto.customerId } });
        if (!customer) {
          throw new NotFoundException({ error: 'CUSTOMER_NOT_FOUND', message: 'Specified customer not found' });
        }
        if (dto.customer?.city) {
          customer = await this.prisma.customer.update({
            where: { id: customer.id },
            data: {
              city: dto.customer.city.trim(),
              mailingAddress: customer.mailingAddress || dto.customer.city.trim(),
            },
          });
        }
      } else if (dto.customer) {
        if (dto.customer.phone) {
          const phoneDigits = dto.customer.phone.replace(/\D/g, '');
          if (phoneDigits.length > 11) {
            throw new BadRequestException({
              error: 'INVALID_PHONE',
              message: 'Customer phone number cannot be greater than 11 digits.',
            });
          }
        }
        const cnicRegex = /^\d{5}-\d{7}-\d{1}$/;
        if (dto.customer.cnic && dto.customer.cnic !== 'Pending' && !cnicRegex.test(dto.customer.cnic)) {
          throw new BadRequestException({
            error: 'INVALID_CNIC',
            message: 'Customer CNIC must be exactly 13 digits in 00000-0000000-0 format.',
          });
        }
        if (dto.customer.nokCnic && !cnicRegex.test(dto.customer.nokCnic)) {
          throw new BadRequestException({
            error: 'INVALID_CNIC',
            message: 'Nominee CNIC must be exactly 13 digits in 00000-0000000-0 format.',
          });
        }

        // The same CNIC must not create a second member: check by CNIC first
        const cnicToFind = dto.customer.cnic && dto.customer.cnic !== 'Pending' ? dto.customer.cnic.trim() : null;
        if (cnicToFind) {
          customer = await tx.customer.findFirst({
            where: { cnic: { equals: cnicToFind, mode: 'insensitive' } },
          });
        }

        if (!customer) {
          customer = await tx.customer.findFirst({
            where: {
              OR: [
                { email: dto.customer.email.trim() },
                { phone: dto.customer.phone.trim() },
              ],
            },
          });
        }

        if (customer) {
          if (dto.customer.city) {
            customer = await tx.customer.update({
              where: { id: customer.id },
              data: {
                city: dto.customer.city.trim(),
                mailingAddress: customer.mailingAddress || dto.customer.city.trim(),
              },
            });
          }
        } else {
          const custId = `cust-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
          customer = await tx.customer.create({
            data: {
              id: custId,
              membershipNo: `PV-M-${Math.floor(1000 + Math.random() * 9000)}`,
              fullName: dto.customer.fullName.trim(),
              fatherOrHusbandName: dto.customer.fatherOrHusbandName?.trim() || 'Pending Information',
              cnic: dto.customer.cnic?.trim() || 'Pending',
              email: dto.customer.email.trim(),
              phone: dto.customer.phone.trim(),
              city: dto.customer.city?.trim() || null,
              mailingAddress: dto.customer.mailingAddress?.trim() || dto.customer.city?.trim() || null,
              nokName: dto.customer.nokName?.trim() || null,
              nokCnic: dto.customer.nokCnic?.trim() || null,
              registrationStatus: 'minimal',
            },
          });
        }
      } else {
        throw new BadRequestException({
          error: 'CUSTOMER_REQUIRED',
          message: 'Either customerId or customer details must be provided',
        });
      }

      // Enforce One Person: Check for live non-void booking
      const existingBooking = await tx.booking.findFirst({
        where: { plotId: plot.id, status: { not: 'void' } },
      });
      if (existingBooking || plot.status === PlotStatus.booked || plot.status === PlotStatus.allotted) {
        throw new ConflictException({
          error: 'ALREADY_BOOKED',
          message: 'Plot already has an active booking',
        });
      }

      // Check for live reservation
      const liveRes = await tx.reservation.findFirst({
        where: {
          plotId: plot.id,
          status: ReservationStatus.active,
          validUntil: { gt: now },
        },
      });

      if (liveRes) {
        // Enforce one person: check if this reservation belongs to the same person
        const isSamePerson =
          (liveRes.customerId && liveRes.customerId === customer.id) ||
          (dto.reservationId && dto.reservationId === liveRes.id) ||
          (liveRes.customerPhone && customer.phone && liveRes.customerPhone.trim() === customer.phone.trim()) ||
          (liveRes.customerEmail && customer.email && liveRes.customerEmail.toLowerCase().trim() === customer.email.toLowerCase().trim());

        if (!isSamePerson) {
          throw new ConflictException({
            error: 'RESERVED_BY_ANOTHER',
            message: 'Plot is currently reserved by another customer',
          });
        }
      }

      if (plot.status === PlotStatus.disputed) {
        throw new ConflictException({
          error: 'PLOT_DISPUTED',
          message: 'Plot is currently disputed and cannot be booked',
        });
      }

      // 3. Atomic Conditional Update on Plot (Hold only: set status to booked, do not allot)
      const pType: PaymentType = dto.paymentType === 'one_time' ? PaymentType.one_time : PaymentType.installment;
      const targetPlotStatus = PlotStatus.booked;

      await updatePlotStatus(tx, {
        plotId,
        fromStatus: plot.status,
        toStatus: targetPlotStatus,
        changedBy: session.adminId || session.username,
        source: 'book',
        plotData: {
          currentOwnerId: customer.id,
          lockedBy: null,
          lockedAt: null,
        },
      });

      const updatedPlot = {
        ...plot,
        status: targetPlotStatus,
        currentOwnerId: customer.id,
        lockedBy: null,
        lockedAt: null,
      };

      // 4. Compute Installment Plan & Validation
      const plotPriceNum = Number(plot.price);

      let installmentPlanData: any = null;
      let schedule: any[] = [];

      if (pType === PaymentType.installment) {
        const plan = dto.installmentPlan;
        const rawYears = plan?.planYears ?? plan?.years ?? (plan as any)?.totalYears ?? (dto as any)?.planYears ?? 1;
        const planYears = Number(rawYears);

        if (![1, 2, 3, 4, 5].includes(planYears)) {
          throw new BadRequestException({
            error: 'INVALID_PLAN_YEARS',
            message: 'Plan length must be 1, 2, 3, 4, or 5 years.',
          });
        }

        schedule = generateFixedSchedule({
          plotPriceRupees: plotPriceNum,
          planYears,
          bookingDate: now,
        });

        const totalRows = planYears * 12;
        const biannualCount = planYears * 2;
        const monthlyCount = totalRows - 1 - biannualCount - 1;

        installmentPlanData = {
          planYears,
          totalPayment: plotPriceNum,
          downpayment: schedule[0].amount,
          monthlyInstallmentCount: monthlyCount,
          biannualInstallmentCount: biannualCount,
          numberOfInstallments: monthlyCount + biannualCount,
        };
      }

      // 5. Create Booking
      const bookingId = `book-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

      const booking = await tx.booking.create({
        data: {
          id: bookingId,
          customerId: customer.id,
          plotId: plot.id,
          paymentType: pType,
          status: 'completed',
          registrationStatus: customer.registrationStatus || 'minimal',
          bookingDate: now,
          confirmationDate: now,
          createdByAdminId: session.adminId || session.username,
          installmentPlan: installmentPlanData,
        },
      });

      // 6. Generate Payment Records in batch via single createMany roundtrip
      const paymentsToCreate: any[] = [];

      if (pType === PaymentType.one_time) {
        paymentsToCreate.push({
          id: `pay-one-${bookingId}`,
          bookingId: booking.id,
          feeType: FeeType.plot_one_time,
          dueDate: now,
          amount: plotPriceNum,
          paidAmount: 0,
          status: PaymentStatus.pending,
        });
      } else {
        for (let i = 0; i < schedule.length; i++) {
          const item = schedule[i];
          paymentsToCreate.push({
            id: `pay-${item.feeType}-${bookingId}-${item.installmentNumber ?? i}`,
            bookingId: booking.id,
            feeType: item.feeType,
            installmentNumber: item.installmentNumber,
            dueDate: item.dueDate,
            amount: item.amount,
            paidAmount: item.paidAmount,
            status: item.status,
          });
        }
      }

      await tx.paymentRecord.createMany({ data: paymentsToCreate });

      // 7. Test-Only Failure Injection (Strictly gated: no-op outside test simulation environment)
      if (process.env.ENABLE_TEST_SIMULATIONS === 'true' && dto.simulateRollback) {
        throw new BadRequestException({
          error: 'SIMULATED_TRANSACTION_FAILURE_ON_DOCUMENT_STEP',
          message: 'Intentional transactional failure triggered at document generation step',
        });
      }

      // 8. Generate SocietyDocument records in batch via single createMany roundtrip
      const societyDocsToCreate: any[] = [
        {
          id: `doc-${bookingId}-1`,
          customerId: customer.id,
          bookingId: booking.id,
          type: GeneratedDocType.booking_confirmation,
          fileName: `Booking_Confirmation_Plot_${plot.plotNumber}.pdf`,
          fileUrl: `/documents/booking-confirmation-${bookingId}.pdf`,
          fileSizeKb: 1420,
        },
        {
          id: `doc-${bookingId}-2`,
          customerId: customer.id,
          bookingId: booking.id,
          type: GeneratedDocType.booking_agreement,
          fileName: `Allotment_Agreement_Plot_${plot.plotNumber}.pdf`,
          fileUrl: `/documents/booking-agreement-${bookingId}.pdf`,
          fileSizeKb: 1420,
        },
        {
          id: `doc-${bookingId}-3`,
          customerId: customer.id,
          bookingId: booking.id,
          type: GeneratedDocType.payment_receipt,
          fileName: `Full_Payment_Receipt_Plot_${plot.plotNumber}.pdf`,
          fileUrl: `/documents/payment-receipt-${bookingId}.pdf`,
          fileSizeKb: 1420,
        },
      ];

      if (pType === PaymentType.installment) {
        societyDocsToCreate.push({
          id: `doc-${bookingId}-4`,
          customerId: customer.id,
          bookingId: booking.id,
          type: GeneratedDocType.installment_schedule,
          fileName: `Installment_Schedule_Plot_${plot.plotNumber}.pdf`,
          fileUrl: `/documents/installment-schedule-${bookingId}.pdf`,
          fileSizeKb: 1420,
        });
      }

      await tx.societyDocument.createMany({ data: societyDocsToCreate });

      // 9. Supersede active and confirmed reservations on that plot
      await tx.reservation.updateMany({
        where: {
          plotId: plot.id,
          status: { in: [ReservationStatus.active, ReservationStatus.confirmed] },
        },
        data: {
          status: ReservationStatus.superseded,
          supersededAt: now,
          supersededByBookingId: bookingId,
          resolutionNote: `Superseded by booking ${bookingId}`,
        },
      });

      // 10. Audit entry for PLOT_BOOKED inside same transaction
      await tx.auditEntry.create({
        data: {
          actorId: session.adminId || session.username,
          actorName: session.fullName || session.username,
          actorRole: session.role,
          action: 'PLOT_BOOKED',
          entityType: 'booking',
          entityId: bookingId,
          details: `Committed booking ${bookingId} for plot ${plot.plotNumber} to ${customer.fullName}`,
          newValue: {
            plotId: plot.id,
            customerId: customer.id,
            bookingId,
            salePrice: plotPriceNum,
            paymentType: pType,
          },
        },
      });

      return {
        booking,
        plot: updatedPlot,
        customer,
        payments: paymentsToCreate,
        societyDocs: societyDocsToCreate,
      };
    });

    // Realtime Broadcasts in parallel (non-blocking)
    Promise.all([
      this.realtime.broadcast(`block:${result.plot.blockId}`, 'PLOT_BOOKED', {
        plotId: result.plot.id,
        bookingId: result.booking.id,
        customerId: result.customer.id,
        bookedBy: session.adminId,
      }),
      this.realtime.broadcast('plots', 'PLOT_BOOKED', {
        plotId: result.plot.id,
        bookingId: result.booking.id,
        customerId: result.customer.id,
        bookedBy: session.adminId,
      }),
    ]).catch((err) => {
      this.logger.warn(`Failed to dispatch realtime broadcasts: ${err.message}`);
    });

    this.logger.log(`[bookPlot:${plotId}] Transaction completed and committed in ${Date.now() - t0}ms (booking: ${result.booking.id})`);

    return {
      ok: true,
      booking: result.booking,
      plot: result.plot,
      customer: result.customer,
    };
  }

  /**
   * Toggle Master Plan Adjustment (Town Planning Re-Survey Freeze) state on a plot.
   * Super Administrator exclusive capability.
   */
  async toggleAdjustment(plotId: string, dto: TogglePlotAdjustmentDto, session: any) {
    if (session.role !== 'super_admin') {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'Only Super Administrators have authority to modify Master Plan plot adjustments.',
      });
    }

    const plot = await this.prisma.withScopedSession(session, async (tx) => {
      return tx.plot.findUnique({ where: { id: plotId } });
    });

    if (!plot) {
      throw new NotFoundException({
        error: 'PLOT_NOT_FOUND',
        message: 'Plot not found in Master Plan.',
      });
    }

    if (dto.isAdjustment && plot.category !== 'residential' && plot.category !== 'commercial') {
      throw new BadRequestException({
        error: 'INVALID_ADJUSTMENT_CATEGORY',
        message: 'Only residential and commercial plots can be put into adjustment.',
      });
    }

    const now = new Date();
    const result = await this.prisma.withScopedSession(session, async (tx) => {
      const updatedPlot = await tx.plot.update({
        where: { id: plot.id },
        data: {
          isAdjustment: dto.isAdjustment,
          adjustmentReason: dto.isAdjustment ? (dto.reason?.trim() || 'Town Planning re-survey and boundary adjustment') : null,
          adjustmentDate: dto.isAdjustment ? now : null,
          adjustmentBy: dto.isAdjustment ? (session.fullName || session.username) : null,
          ...(dto.isAdjustment ? { lockedBy: null, lockedAt: null } : {}),
        },
      });

      const detailsMsg = dto.isAdjustment
        ? `Plot ${plot.plotNumber} (${plot.blockId}) placed under Administrative Adjustment / Re-Survey Freeze. Reason: ${updatedPlot.adjustmentReason}`
        : `Plot ${plot.plotNumber} (${plot.blockId}) released from Administrative Adjustment / Re-Survey Freeze`;

      await tx.auditEntry.create({
        data: {
          actorId: session.adminId || session.username,
          actorName: session.fullName || session.username,
          actorRole: session.role,
          action: 'PLOT_ADJUSTMENT_TOGGLED',
          entityType: 'plot',
          entityId: plot.id,
          details: detailsMsg,
          newValue: { isAdjustment: dto.isAdjustment, reason: updatedPlot.adjustmentReason },
        },
      });

      return updatedPlot;
    });

    await this.realtime.broadcast(`block:${plot.blockId}`, 'PLOT_ADJUSTMENT_TOGGLED', {
      plotId: plot.id,
      isAdjustment: dto.isAdjustment,
      reason: result.adjustmentReason,
    });
    await this.realtime.broadcast('plots', 'PLOT_ADJUSTMENT_TOGGLED', {
      plotId: plot.id,
      isAdjustment: dto.isAdjustment,
      reason: result.adjustmentReason,
    });
    await this.realtime.broadcast('plots', 'PLOT_STATUS_CHANGED', {
      plotId: plot.id,
      newStatus: result.status,
    });

    return {
      ok: true,
      plot: result,
      message: dto.isAdjustment
        ? `Plot ${plot.plotNumber} flagged for Master Plan Adjustment.`
        : `Plot ${plot.plotNumber} adjustment hold released.`,
    };
  }

  /**
   * PATCH /plots/:id/price
   * Super Admin updates plot price.
   * Rejects with 409 Conflict if paid payment records exist for this plot in the ledger.
   * PaymentRecord.amount is NEVER touched.
   */
  async updatePlotPrice(plotId: string, dto: UpdatePlotPriceDto, session: any) {
    if (!dto.price || dto.price <= 0) {
      throw new BadRequestException({
        error: 'INVALID_PRICE',
        message: 'Price must be a positive number.',
      });
    }

    return this.prisma.withScopedSession(session, async (tx) => {
      const plot = await tx.plot.findUnique({
        where: { id: plotId },
        include: {
          bookings: {
            include: {
              payments: true,
            },
          },
        },
      });

      if (!plot) {
        throw new NotFoundException({
          error: 'PLOT_NOT_FOUND',
          message: 'Plot not found.',
        });
      }

      const isSuper = session.role === 'super_admin';
      const isAuthorizedSubAdmin =
        Boolean(session.permissions?.can_book) &&
        Array.isArray(session.assignedBlocks) &&
        session.assignedBlocks.includes(plot.blockId);

      if (!isSuper && !isAuthorizedSubAdmin) {
        throw new ForbiddenException({
          error: 'FORBIDDEN',
          message: 'Plot pricing adjustments require Super Admin or Sub-Admin with Book Plots permission in this block.',
        });
      }

      // Check if plot has paid plot payments
      const hasPaidPlotPayments = plot.bookings.some((b) =>
        b.payments.some(
          (p) =>
            p.status === 'paid' &&
            Number(p.paidAmount) > 0 &&
            ['plot_downpayment', 'plot_installment', 'plot_biannual', 'plot_possession', 'plot_one_time'].includes(p.feeType),
        ),
      );

      if (hasPaidPlotPayments) {
        throw new ConflictException({
          error: 'CANNOT_MODIFY_PRICE_WITH_PAID_RECORDS',
          message: 'Cannot change plot price because plot payments have already been recorded.',
        });
      }

      const oldPrice = Number(plot.price);
      const newPrice = Number(dto.price);
      if (isNaN(newPrice) || newPrice <= 0) {
        throw new BadRequestException({
          error: 'INVALID_PLOT_PRICE',
          message: 'Plot price must be greater than zero.',
        });
      }

      const updatedPlot = await tx.plot.update({
        where: { id: plotId },
        data: {
          price: new Prisma.Decimal(newPrice),
        },
      });

      for (const booking of plot.bookings) {
        if (booking.installmentPlan) {
          const plan = booking.installmentPlan as any;
          const planYears = Number(plan.planYears || plan.years || 1);
          const downpayment = Math.floor(newPrice * 0.25);
          const totalRows = planYears * 12;
          const biannualCount = planYears * 2;
          const monthlyCount = totalRows - 1 - biannualCount - 1;
          const numberOfInstallments = monthlyCount + biannualCount;

          await tx.booking.update({
            where: { id: booking.id },
            data: {
              installmentPlan: {
                ...plan,
                totalPayment: newPrice,
                downpayment,
                monthlyInstallmentCount: monthlyCount,
                biannualInstallmentCount: biannualCount,
                numberOfInstallments,
              },
            },
          });

          // Check if this booking had existing plot bills
          const existingPlotBills = (booking.payments || []).filter((p: any) =>
            ['plot_installment', 'plot_downpayment', 'plot_one_time', 'plot_biannual', 'plot_possession'].includes(p.feeType),
          );

          if (existingPlotBills.length > 0) {
            // Delete only unpaid plot bills
            await tx.paymentRecord.deleteMany({
              where: {
                bookingId: booking.id,
                feeType: { in: [FeeType.plot_installment, FeeType.plot_downpayment, FeeType.plot_one_time, FeeType.plot_biannual, FeeType.plot_possession] },
                paidAmount: 0,
                status: { not: PaymentStatus.paid },
              },
            });

            if (booking.paymentType === PaymentType.installment) {
              const schedule = generateFixedSchedule({
                plotPriceRupees: newPrice,
                planYears,
                bookingDate: booking.bookingDate || new Date(),
              });

              // Check if downpayment was already paid
              const existingPaidDown = existingPlotBills.find(
                (p: any) => p.feeType === 'plot_downpayment' && (p.paidAmount > 0 || p.status === 'paid'),
              );

              const billsToCreate: any[] = [];
              for (let i = 0; i < schedule.length; i++) {
                const item = schedule[i];
                if (item.feeType === FeeType.plot_downpayment && existingPaidDown) {
                  continue;
                }
                billsToCreate.push({
                  id: `pay-${item.feeType}-${booking.id}-${item.installmentNumber ?? i}-${Date.now()}-${i}`,
                  bookingId: booking.id,
                  feeType: item.feeType,
                  installmentNumber: item.installmentNumber,
                  dueDate: item.dueDate,
                  amount: item.amount,
                  paidAmount: item.paidAmount,
                  status: item.status,
                });
              }
              if (billsToCreate.length > 0) {
                await tx.paymentRecord.createMany({ data: billsToCreate });
              }
            } else if (booking.paymentType === PaymentType.one_time) {
              await tx.paymentRecord.create({
                data: {
                  id: `pay-one-${booking.id}-${Date.now()}`,
                  bookingId: booking.id,
                  feeType: FeeType.plot_one_time,
                  dueDate: new Date(),
                  amount: newPrice,
                  paidAmount: 0,
                  status: PaymentStatus.pending,
                },
              });
            }
          }

          await tx.auditEntry.updateMany({
            where: {
              action: 'PLOT_BOOKED',
              OR: [
                { entityId: booking.id },
                { newValue: { path: ['bookingId'], equals: booking.id } },
              ],
            },
            data: {
              newValue: {
                plotId: plot.id,
                customerId: booking.customerId,
                bookingId: booking.id,
                paymentType: booking.paymentType,
                salePrice: newPrice,
                plotNumber: plot.plotNumber,
              },
            },
          });
        }
      }

      await tx.auditEntry.create({
        data: {
          actorId: session.adminId || session.username,
          actorName: session.fullName || session.username,
          actorRole: session.role,
          action: 'PLOT_PRICE_UPDATED',
          entityType: 'plot',
          entityId: plotId,
          details: `Updated price for plot ${plot.plotNumber} from PKR ${oldPrice.toLocaleString()} to PKR ${newPrice.toLocaleString()}`,
          oldValue: { price: oldPrice },
          newValue: { price: newPrice },
        },
      });

      return {
        ok: true,
        plot: updatedPlot,
      };
    });
  }
}
