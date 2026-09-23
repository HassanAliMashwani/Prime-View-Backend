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
import { updatePlotStatus } from './update-plot-status';
import { ReservePlotDto } from './dto/reserve-plot.dto';
import { BookPlotDto } from './dto/book-plot.dto';
import { TogglePlotAdjustmentDto } from './dto/toggle-adjustment.dto';
import { GeneratedDocType, PaymentType, FeeType, PaymentStatus, ReservationStatus, PlotStatus } from '@prisma/client';

import { attachDisplayStatus } from './display-status';

@Injectable()
export class PlotsService {
  private readonly logger = new Logger(PlotsService.name);

  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeService,
  ) {}

  async findAll(blockId: string, session: any) {
    let whereClause: any = {};
    if (blockId) {
      whereClause.blockId = blockId;
    } else if (session.role !== 'super_admin') {
      whereClause.blockId = { in: session.assignedBlocks || [] };
    }

    return this.prisma.withScopedSession(session, async (tx) => {
      const plots = await tx.plot.findMany({
        where: whereClause,
        include: {
          reservations: true,
          currentOwner: {
            select: {
              id: true,
              accountStatus: true,
            },
          },
        },
      });

      return plots.map(attachDisplayStatus);
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
    await this.getPlotWithScopeCheck(id, session);

    return this.prisma.withScopedSession(session, async (tx) => {
      const plot = await tx.plot.findUnique({
        where: { id },
        include: {
          reservations: true,
          currentOwner: {
            select: {
              id: true,
              accountStatus: true,
            },
          },
        },
      });

      if (!plot) return null;
      return attachDisplayStatus(plot);
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
      const plot = await tx.plot.findUnique({ where: { id: plotId } });
      if (!plot) {
        throw new NotFoundException({ error: 'PLOT_NOT_FOUND', message: 'Plot not found' });
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
          message: 'Amenity plots cannot be locked, reserved or booked',
        });
      }

      if (plot.status === PlotStatus.booked || plot.status === PlotStatus.allotted || plot.status === PlotStatus.disputed) {
        throw new ConflictException({
          error: 'PLOT_NOT_AVAILABLE',
          message: `Plot is ${plot.status} and cannot be locked`,
        });
      }

      // Check existing lock
      if (plot.lockedBy && plot.lockedBy !== session.adminId) {
        if (plot.lockedAt && now.getTime() - plot.lockedAt.getTime() <= lockExpiryWindowMs) {
          throw new ConflictException({
            error: 'LOCKED_BY_ANOTHER',
            message: 'Plot is currently locked by another admin',
            lockedBy: plot.lockedBy,
            lockedAt: plot.lockedAt,
          });
        }
      }

      const updatedPlot = await tx.plot.update({
        where: { id: plotId },
        data: {
          lockedBy: session.adminId,
          lockedAt: now,
        },
      });

      const audit = await tx.auditEntry.create({
        data: {
          actorId: session.adminId || session.username,
          actorName: session.fullName || session.username,
          actorRole: session.role,
          action: 'PLOT_LOCK_ACQUIRED',
          entityType: 'lock',
          entityId: plotId,
          details: `Admin ${session.fullName || session.username} acquired 10m booking lock on ${plot.plotNumber}`,
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
      plot: result.updatedPlot,
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
        customer = await tx.customer.findUnique({ where: { id: dto.customerId } });
        if (!customer) {
          throw new NotFoundException({ error: 'CUSTOMER_NOT_FOUND', message: 'Specified customer not found' });
        }
      } else if (dto.customer) {
        customer = await tx.customer.findFirst({
          where: {
            OR: [
              { email: dto.customer.email.trim() },
              { phone: dto.customer.phone.trim() },
              ...(dto.customer.cnic && dto.customer.cnic !== 'Pending' ? [{ cnic: dto.customer.cnic.trim() }] : []),
            ],
          },
        });

        if (!customer) {
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
              mailingAddress: dto.customer.mailingAddress?.trim() || null,
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

      // 3. Atomic Conditional Update on Plot
      const pType: PaymentType = dto.paymentType === 'one_time' ? PaymentType.one_time : PaymentType.installment;
      const targetPlotStatus = pType === PaymentType.one_time ? PlotStatus.allotted : PlotStatus.booked;

      await updatePlotStatus(tx, {
        plotId,
        fromStatus: plot.status,
        toStatus: targetPlotStatus,
        changedBy: session.adminId || session.username,
        source: pType === PaymentType.one_time ? 'allot' : 'book',
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
      let downpaymentAmount = 0;
      let remainingBalance = 0;
      let numberOfInstallments = 0;
      let paidAfterEvery = 3;

      if (pType === PaymentType.installment) {
        const plan = dto.installmentPlan;
        const totalPayment = plan?.totalPayment || dto.salePrice || plotPriceNum;
        downpaymentAmount = plan?.downpayment !== undefined
          ? Math.max(0, plan.downpayment)
          : (dto.downPayment !== undefined ? Math.max(0, dto.downPayment) : Math.round(plotPriceNum / 4));
        const planYears = plan?.planYears || plan?.years || 2;
        paidAfterEvery = plan?.paidAfterEveryMonths || plan?.paidAfterEvery || 3;
        numberOfInstallments = plan?.numberOfInstallments || Math.ceil((planYears * 12) / paidAfterEvery);

        // Form-level validation guard: 0 <= downpayment < totalPayment
        if (downpaymentAmount >= totalPayment) {
          throw new BadRequestException({
            error: 'INVALID_DOWNPAYMENT',
            message: 'Downpayment must be less than Total Payment price.',
          });
        }

        remainingBalance = totalPayment - downpaymentAmount;

        installmentPlanData = {
          totalPayment,
          downpayment: downpaymentAmount,
          planYears,
          paidAfterEveryMonths: paidAfterEvery,
          numberOfInstallments,
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
      const paymentsToCreate: any[] = [
        {
          id: `fee-adm-${bookingId}`,
          bookingId: booking.id,
          feeType: FeeType.admission_fee,
          dueDate: now,
          amount: 2000,
          paidAmount: 2000,
          status: PaymentStatus.paid,
        },
        {
          id: `fee-sub-${bookingId}`,
          bookingId: booking.id,
          feeType: FeeType.share_subscription_fee,
          dueDate: now,
          amount: 10000,
          paidAmount: 10000,
          status: PaymentStatus.paid,
        },
      ];

      if (pType === PaymentType.one_time) {
        paymentsToCreate.push({
          id: `pay-one-${bookingId}`,
          bookingId: booking.id,
          feeType: FeeType.plot_one_time,
          dueDate: now,
          amount: plotPriceNum,
          paidAmount: plotPriceNum,
          status: PaymentStatus.paid,
        });
      } else {
        if (downpaymentAmount > 0) {
          paymentsToCreate.push({
            id: `pay-down-${bookingId}`,
            bookingId: booking.id,
            feeType: FeeType.plot_downpayment,
            installmentNumber: 0,
            dueDate: now,
            amount: downpaymentAmount,
            paidAmount: downpaymentAmount,
            status: PaymentStatus.paid,
          });
        }

        const baseInstallmentAmount = Math.floor(remainingBalance / numberOfInstallments);
        const roundingRemainder = remainingBalance - (baseInstallmentAmount * numberOfInstallments);

        for (let i = 1; i <= numberOfInstallments; i++) {
          const dueDate = new Date(now.getFullYear(), now.getMonth() + (i * paidAfterEvery), 5);
          const currentInstAmount = i === numberOfInstallments
            ? baseInstallmentAmount + roundingRemainder
            : baseInstallmentAmount;

          paymentsToCreate.push({
            id: `pay-inst-${bookingId}-${i}`,
            bookingId: booking.id,
            feeType: FeeType.plot_installment,
            installmentNumber: i,
            dueDate,
            amount: currentInstAmount,
            paidAmount: 0,
            status: PaymentStatus.pending,
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

      // 9. Confirm active reservation if converting
      if (liveRes) {
        await tx.reservation.update({
          where: { id: liveRes.id },
          data: {
            status: ReservationStatus.confirmed,
            confirmedAt: now,
            confirmedByBookingId: bookingId,
            resolutionNote: `Confirmed into booking ${bookingId}`,
          },
        });
      }

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
}
