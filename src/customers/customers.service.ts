import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import * as bcrypt from 'bcrypt';
import {
  PaymentType,
  FeeType,
  PaymentStatus,
  PlotStatus,
  GeneratedDocType,
  DocumentType,
} from '@prisma/client';
import { CreateMinimalBookingDto } from './dto/create-minimal-booking.dto';
import { CompleteRegistrationDto } from './dto/complete-registration.dto';
import { CreateCustomerWithBookingDto } from './dto/create-customer-with-booking.dto';
import { AddBookingDto } from './dto/add-booking.dto';
import { AssignStrikeDto, ToggleSuspensionDto } from './dto/customer-actions.dto';
import { UploadCustomerDocumentDto } from './dto/customer-document.dto';
import { UpdateCustomerProfileDto } from './dto/update-customer-profile.dto';
import { ChangeCustomerPasswordDto } from './dto/change-customer-password.dto';
import { updatePlotStatus } from '../plots/update-plot-status';
import { calculateInstallmentDueDates } from '../common/installment-dates';

@Injectable()
export class CustomersService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeService,
  ) {}

  /**
   * Helper: System lookup to verify plot registration and validate administrative block scope.
   */
  private async getPlotWithScopeCheck(plotId: string, session: any) {
    const plot = await this.prisma.withScopedSession(session, async (tx) => {
      return tx.plot.findUnique({
        where: { id: plotId },
        include: { block: true },
      });
    });

    if (!plot) {
      throw new NotFoundException({
        error: 'PLOT_NOT_REGISTERED',
        message: 'This plot is not registered on the master plan map. Kindly register the plot before proceeding.',
      });
    }

    if (session.role !== 'super_admin') {
      const assigned = session.assignedBlocks || [];
      if (!assigned.includes(plot.blockId)) {
        throw new ForbiddenException({
          error: 'OUT_OF_SCOPE',
          message: 'Plot is outside your assigned administrative block scope.',
        });
      }
    }

    if (plot.category === 'amenity') {
      throw new BadRequestException({
        error: 'AMENITY_NOT_SELLABLE',
        message: 'Amenity utility plots cannot be booked or sold.',
      });
    }

    if (plot.isAdjustment) {
      throw new BadRequestException({
        error: 'PLOT_UNDER_ADJUSTMENT',
        message: 'This plot is under administrative adjustment/re-survey and cannot be booked.',
      });
    }

    if (plot.status === PlotStatus.booked || plot.status === PlotStatus.allotted) {
      throw new ConflictException({
        error: 'PLOT_ALREADY_BOOKED',
        message: 'This plot has already been committed to another owner.',
      });
    }

    // Lock check
    if (plot.lockedBy && plot.lockedBy !== session.adminId) {
      if (plot.lockedAt && Date.now() - plot.lockedAt.getTime() <= 10 * 60 * 1000) {
        throw new ConflictException({
          error: 'LOCKED_BY_ANOTHER',
          message: 'Plot is currently locked by another admin',
        });
      }
    }

    return plot;
  }

  /**
   * Helper: Compute installment schedule with upfront downpayment and remainder absorption.
   */
  private computeInstallmentPlan(
    totalPrice: number,
    downpaymentInput: number | undefined,
    plan: any,
    pType: PaymentType,
  ) {
    if (pType === PaymentType.one_time) {
      return {
        installmentPlanData: null,
        downpaymentAmount: 0,
        remainingBalance: 0,
        numberOfInstallments: 0,
        paidAfterEvery: 0,
        baseInstallmentAmount: 0,
        roundingRemainder: 0,
      };
    }

    const totalPayment = plan?.totalPayment || totalPrice;
    const downpaymentAmount =
      plan?.downpayment !== undefined
        ? Math.max(0, plan.downpayment)
        : downpaymentInput !== undefined
          ? Math.max(0, downpaymentInput)
          : Math.round(totalPrice / 4);
    const planYears = plan?.planYears || plan?.years || 2;
    const paidAfterEvery = plan?.paidAfterEveryMonths || plan?.paidAfterEvery || 3;
    const numberOfInstallments =
      plan?.numberOfInstallments || Math.ceil((planYears * 12) / paidAfterEvery);

    if (downpaymentAmount >= totalPayment) {
      throw new BadRequestException({
        error: 'INVALID_DOWNPAYMENT',
        message: 'Downpayment must be less than Total Payment price.',
      });
    }

    const remainingBalance = totalPayment - downpaymentAmount;
    const baseInstallmentAmount = Math.floor(remainingBalance / numberOfInstallments);
    const roundingRemainder = remainingBalance - baseInstallmentAmount * numberOfInstallments;

    const installmentPlanData = {
      totalPayment,
      downpayment: downpaymentAmount,
      planYears,
      paidAfterEveryMonths: paidAfterEvery,
      numberOfInstallments,
    };

    return {
      installmentPlanData,
      downpaymentAmount,
      remainingBalance,
      numberOfInstallments,
      paidAfterEvery,
      baseInstallmentAmount,
      roundingRemainder,
    };
  }

  async findAll(session: any) {
    let whereClause: any = {};
    if (session.role !== 'super_admin') {
      whereClause = {
        bookings: {
          some: {
            plot: {
              blockId: { in: session.assignedBlocks },
            },
          },
        },
      };
    }

    const customers = await this.prisma.withScopedSession(session, async (tx) => {
      return tx.customer.findMany({
        where: whereClause,
        include: {
          bookings: {
            include: {
              plot: true,
            },
          },
          documents: true,
          strikes: true,
        },
      });
    });

    if (session.role !== 'super_admin') {
      customers.forEach((customer) => {
        customer.bookings = customer.bookings.filter((b) =>
          session.assignedBlocks.includes(b.plot.blockId),
        );
      });
    }

    return customers;
  }

  async findOne(id: string, session: any) {
    if (session.role === 'customer' && session.customerId !== id) {
      throw new ForbiddenException({
        reason: 'IDENTITY_REJECTED',
        message: 'You can only view your own profile',
      });
    }

    const customer = await this.prisma.withScopedSession(session, async (tx) => {
      return tx.customer.findUnique({
        where: { id },
        include: {
          bookings: {
            include: {
              plot: true,
              payments: true,
              societyDocuments: true,
            },
          },
          documents: true,
          strikes: true,
        },
      });
    });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    if (session.role !== 'super_admin' && session.role !== 'customer') {
      const hasAccess = customer.bookings.some((b) =>
        session.assignedBlocks.includes(b.plot.blockId),
      );
      if (!hasAccess && customer.registrationStatus !== 'minimal') {
        throw new ForbiddenException({
          reason: 'OUT_OF_SCOPE',
          message: 'You do not have access to this customer',
        });
      }
      customer.bookings = customer.bookings.filter((b) =>
        session.assignedBlocks.includes(b.plot.blockId),
      );
    }

    return customer;
  }

  /**
   * 1. POST /customers/minimal-booking
   * Minimal Sub Admin Quick Booking Flow (Change Request 07 §5).
   * Creates Customer (minimal, credentialsPending: true) + Booking + flips Plot to booked in 1 atomic transaction.
   */
  async createMinimalBooking(dto: CreateMinimalBookingDto, session: any) {
    const isSuper = session.role === 'super_admin';
    const canBook = Boolean(session.permissions?.can_book || session.permissions?.can_create_customer);
    if (!isSuper && !canBook) {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'You do not have permission to book plots.',
      });
    }

    const plot = await this.getPlotWithScopeCheck(dto.plotId, session);

    const now = new Date();
    const customerId = `cust-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const bookingId = `book-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    const result = await this.prisma.withScopedSession(session, async (tx) => {
      // 1. Create Minimal Customer
      const newCustomer = await tx.customer.create({
        data: {
          id: customerId,
          fullName: dto.customerName.trim(),
          cnic: dto.cnic.trim(),
          city: dto.city.trim(),
          mailingAddress: dto.city.trim(),
          registrationStatus: 'minimal',
          credentialsPending: true,
          accountStatus: 'active',
          termsAccepted: false,
        },
      });

      // 2. Create Booking
      const newBooking = await tx.booking.create({
        data: {
          id: bookingId,
          customerId: newCustomer.id,
          plotId: plot.id,
          paymentType: PaymentType.installment,
          status: 'active',
          registrationStatus: 'minimal',
          bookingDate: now,
          createdByAdminId: session.adminId || session.username,
        },
      });

      // 3. Flip Plot to booked/allotted & clear locks
      const pType = (dto as any).paymentType === 'one_time' ? PaymentType.one_time : PaymentType.installment;
      const targetPlotStatus = pType === PaymentType.one_time ? PlotStatus.allotted : PlotStatus.booked;

      await updatePlotStatus(tx, {
        plotId: plot.id,
        fromStatus: plot.status,
        toStatus: targetPlotStatus,
        changedBy: session.adminId || session.username,
        source: pType === PaymentType.one_time ? 'allot' : 'book',
        plotData: {
          currentOwnerId: newCustomer.id,
          lockedBy: null,
          lockedAt: null,
        },
      });

      const updatedPlot = {
        ...plot,
        status: targetPlotStatus,
        currentOwnerId: newCustomer.id,
        lockedBy: null,
        lockedAt: null,
      };

      // 4. Supersede prior active reservations
      await tx.reservation.updateMany({
        where: { plotId: plot.id, status: 'active' },
        data: { status: 'superseded', supersededAt: now, supersededByBookingId: bookingId },
      });

      // 5. System Document
      const doc = await tx.societyDocument.create({
        data: {
          id: `doc-${bookingId}-1`,
          customerId: newCustomer.id,
          bookingId: newBooking.id,
          type: GeneratedDocType.booking_confirmation,
          fileName: `Quick_Booking_Confirmation_Plot_${plot.plotNumber}.pdf`,
          fileUrl: `/documents/booking-confirmation-${bookingId}.pdf`,
          fileSizeKb: 1024,
        },
      });

      // 6. Audit Entry
      await tx.auditEntry.create({
        data: {
          actorId: session.adminId || session.username,
          actorName: session.fullName || session.username,
          actorRole: session.role,
          action: 'PLOT_BOOKED',
          entityType: 'booking',
          entityId: bookingId,
          details: `Quick Booking for Plot ${plot.plotNumber} created by ${session.fullName || session.username} for ${newCustomer.fullName} (Minimal Registration)`,
          newValue: {
            plotNumber: plot.plotNumber,
            customerName: newCustomer.fullName,
            cnic: newCustomer.cnic,
            city: newCustomer.city,
          },
        },
      });

      return { customer: newCustomer, booking: newBooking, plot: updatedPlot, doc };
    });

    // Supabase Realtime Broadcasts
    await this.realtime.broadcast(`block:${plot.blockId}`, 'PLOT_BOOKED', {
      plotId: plot.id,
      bookingId,
      customerId,
      bookedBy: session.adminId,
    });
    await this.realtime.broadcast('plots', 'PLOT_BOOKED', {
      plotId: plot.id,
      bookingId,
      customerId,
      bookedBy: session.adminId,
    });
    await this.realtime.broadcast('customers', 'CUSTOMER_CREATED', { customerId });

    return {
      ok: true,
      customer: result.customer,
      booking: result.booking,
    };
  }

  /**
   * 2. POST /customers/:id/complete-registration
   * Super Admin Action: Complete Member Registration (Change Request 07 §5).
   * Upgrades minimal customer to 'complete', generates password, establishes official installment schedule & fees.
   */
  async completeMemberRegistration(id: string, dto: CompleteRegistrationDto, session: any) {
    if (session.role !== 'super_admin') {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'Only Super Administrator has authority to complete member registrations and issue official membership numbers.',
      });
    }

    const customer = await this.prisma.withScopedSession(session, async (tx) => {
      return tx.customer.findUnique({
        where: { id },
        include: { bookings: { include: { plot: true } } },
      });
    });

    if (!customer) {
      throw new NotFoundException({ error: 'CUSTOMER_NOT_FOUND', message: 'Customer record not found.' });
    }

    if (customer.registrationStatus === 'complete' && !customer.credentialsPending && customer.membershipNo) {
      throw new BadRequestException({
        error: 'ALREADY_COMPLETE',
        message: 'Customer registration is already complete.',
      });
    }

    const targetMembershipNo = dto.membershipNo.trim();
    const dupMem = await this.prisma.withScopedSession(session, async (tx) => {
      return tx.customer.findFirst({
        where: {
          membershipNo: { equals: targetMembershipNo, mode: 'insensitive' },
          id: { not: customer.id },
        },
      });
    });

    if (dupMem) {
      throw new BadRequestException({
        error: 'MEMBERSHIP_EXISTS',
        message: `Membership Number "${targetMembershipNo}" is already assigned to ${dupMem.fullName}.`,
      });
    }

    const booking = dto.bookingId
      ? customer.bookings.find((b) => b.id === dto.bookingId)
      : customer.bookings[0];

    if (!booking) {
      throw new BadRequestException({
        error: 'BOOKING_NOT_FOUND',
        message: 'No associated booking found for this customer.',
      });
    }

    const plot = booking.plot;
    const now = new Date();
    if (!dto.portalPassword || dto.portalPassword.trim().length === 0) {
      throw new BadRequestException({
        error: 'PASSWORD_REQUIRED',
        message: 'Portal password is required to complete member registration.',
      });
    }
    const initialPassword = dto.portalPassword.trim();
    const passwordHash = await bcrypt.hash(initialPassword, 10);

    const pType = dto.paymentType === 'one_time' ? PaymentType.one_time : PaymentType.installment;
    const {
      installmentPlanData,
      downpaymentAmount,
      numberOfInstallments,
      paidAfterEvery,
      baseInstallmentAmount,
      roundingRemainder,
    } = this.computeInstallmentPlan(Number(plot.price), undefined, dto.installmentPlan, pType);

    const result = await this.prisma.withScopedSession(session, async (tx) => {
      // 1. Update Customer
      const updatedCustomer = await tx.customer.update({
        where: { id: customer.id },
        data: {
          membershipNo: targetMembershipNo,
          fatherOrHusbandName: dto.fatherOrHusbandName.trim(),
          phone: dto.phone.trim(),
          email: dto.email.trim(),
          mailingAddress: dto.mailingAddress.trim(),
          nokName: dto.nokName.trim(),
          nokCnic: dto.nokCnic.trim(),
          registrationStatus: 'complete',
          credentialsPending: false,
          passwordHash,
        },
      });

      // 2. Update Booking
      const updatedBooking = await tx.booking.update({
        where: { id: booking.id },
        data: {
          registrationStatus: 'complete',
          status: 'completed',
          confirmationDate: now,
          paymentType: pType,
          installmentPlan: installmentPlanData,
          paperInstallmentRef: dto.paperInstallmentRef?.trim() || null,
        },
      });

      // 3. Create Fixed Statutory Fees (PKR 2,000 Admission Fee, PKR 10,000 Share Subscription Fee)
      const admFee = await tx.paymentRecord.create({
        data: {
          id: `fee-adm-${booking.id}`,
          bookingId: booking.id,
          feeType: FeeType.admission_fee,
          dueDate: now,
          amount: 2000,
          paidAmount: 2000,
          status: PaymentStatus.paid,
        },
      });

      const subFee = await tx.paymentRecord.create({
        data: {
          id: `fee-sub-${booking.id}`,
          bookingId: booking.id,
          feeType: FeeType.share_subscription_fee,
          dueDate: now,
          amount: 10000,
          paidAmount: 10000,
          status: PaymentStatus.paid,
        },
      });

      const paymentRecords = [admFee, subFee];

      // 4. Plot Price Payment Records
      if (pType === PaymentType.one_time) {
        const fullPay = await tx.paymentRecord.create({
          data: {
            id: `pay-one-${booking.id}`,
            bookingId: booking.id,
            feeType: FeeType.plot_one_time,
            dueDate: now,
            amount: Number(plot.price),
            paidAmount: Number(plot.price),
            status: PaymentStatus.paid,
          },
        });
        paymentRecords.push(fullPay);
      } else {
        if (downpaymentAmount > 0) {
          const downRec = await tx.paymentRecord.create({
            data: {
              id: `pay-down-${booking.id}`,
              bookingId: booking.id,
              feeType: FeeType.plot_downpayment,
              installmentNumber: 0,
              dueDate: now,
              amount: downpaymentAmount,
              paidAmount: downpaymentAmount,
              status: PaymentStatus.paid,
            },
          });
          paymentRecords.push(downRec);
        }

        const installmentDueDates = calculateInstallmentDueDates(now, numberOfInstallments, paidAfterEvery);

        for (let i = 1; i <= numberOfInstallments; i++) {
          const dueDate = installmentDueDates[i - 1];
          const currentInstAmount =
            i === numberOfInstallments ? baseInstallmentAmount + roundingRemainder : baseInstallmentAmount;

          const instRec = await tx.paymentRecord.create({
            data: {
              id: `pay-inst-${booking.id}-${i}`,
              bookingId: booking.id,
              feeType: FeeType.plot_installment,
              installmentNumber: i,
              dueDate,
              amount: currentInstAmount,
              paidAmount: 0,
              status: PaymentStatus.pending,
            },
          });
          paymentRecords.push(instRec);
        }
      }

      // 5. Society Documents
      const agreementDoc = await tx.societyDocument.create({
        data: {
          id: `doc-${booking.id}-agr`,
          customerId: customer.id,
          bookingId: booking.id,
          type: GeneratedDocType.booking_agreement,
          fileName: `Allotment_Agreement_${targetMembershipNo}_${plot.plotNumber}.pdf`,
          fileUrl: `/documents/booking-agreement-${booking.id}.pdf`,
          fileSizeKb: 1420,
        },
      });

      const scheduleDoc = await tx.societyDocument.create({
        data: {
          id: `doc-${booking.id}-sch`,
          customerId: customer.id,
          bookingId: booking.id,
          type: GeneratedDocType.installment_schedule,
          fileName: `Installment_Schedule_${targetMembershipNo}_${plot.plotNumber}.pdf`,
          fileUrl: `/documents/installment-schedule-${booking.id}.pdf`,
          fileSizeKb: 1420,
        },
      });

      // 6. Optional Physical Documents
      if (dto.applicantPhotoUrl) {
        await tx.customerDocument.create({
          data: {
            id: `cdoc-${booking.id}-photo`,
            customerId: customer.id,
            bookingId: booking.id,
            type: DocumentType.applicant_photo,
            fileName: 'applicant_photo.jpg',
            fileUrl: dto.applicantPhotoUrl,
            fileSizeKb: 250,
            uploadedById: session.adminId || session.username,
          },
        });
      }
      if (dto.cnicCopyUrl) {
        await tx.customerDocument.create({
          data: {
            id: `cdoc-${booking.id}-cnic`,
            customerId: customer.id,
            bookingId: booking.id,
            type: DocumentType.cnic_copy,
            fileName: 'applicant_cnic.pdf',
            fileUrl: dto.cnicCopyUrl,
            fileSizeKb: 500,
            uploadedById: session.adminId || session.username,
          },
        });
      }

      // 7. Audit Entry
      await tx.auditEntry.create({
        data: {
          actorId: session.adminId || session.username,
          actorName: session.fullName || session.username,
          actorRole: session.role,
          action: 'CUSTOMER_UPDATED',
          entityType: 'customer',
          entityId: customer.id,
          details: `Super Admin ${session.fullName || session.username} completed full registration for Member ${updatedCustomer.fullName} (${updatedCustomer.membershipNo}) on Plot ${plot.plotNumber}`,
          newValue: {
            membershipNo: updatedCustomer.membershipNo,
            plotNumber: plot.plotNumber,
            paymentType: updatedBooking.paymentType,
          },
        },
      });

      return { customer: updatedCustomer, booking: updatedBooking, paymentRecords, documents: [agreementDoc, scheduleDoc] };
    });

    await this.realtime.broadcast('customers', 'CUSTOMER_UPDATED', {
      customerId: customer.id,
      membershipNo: targetMembershipNo,
    });
    await this.realtime.broadcast(`block:${plot.blockId}`, 'BOOKING_CREATED', {
      bookingId: booking.id,
      customerId: customer.id,
    });

    return {
      ok: true,
      customer: result.customer,
      booking: result.booking,
      credentials: {
        username: targetMembershipNo,
        password: initialPassword,
      },
      message: `Member registration completed successfully for ${result.customer.fullName} (${targetMembershipNo}).`,
    };
  }

  /**
   * 3. POST /customers (Path A)
   * Create new Customer account and attach first Plot Booking.
   */
  async createCustomerWithBooking(dto: CreateCustomerWithBookingDto, session: any) {
    if (session.role !== 'super_admin' && !session.permissions?.can_create_customer) {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'You do not have permission to register new customers.',
      });
    }

    const plot = await this.getPlotWithScopeCheck(dto.plotId, session);

    // Membership uniqueness check
    const targetMembershipNo = dto.membershipNo.trim();
    const dupMem = await this.prisma.withScopedSession(session, async (tx) => {
      return tx.customer.findFirst({
        where: { membershipNo: { equals: targetMembershipNo, mode: 'insensitive' } },
      });
    });
    if (dupMem) {
      throw new BadRequestException({
        error: 'MEMBERSHIP_EXISTS',
        message: `Membership Number "${targetMembershipNo}" is already assigned to ${dupMem.fullName}.`,
      });
    }

    const now = new Date();
    const customerId = `cust-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const bookingId = `book-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    if (!dto.portalPassword || dto.portalPassword.trim().length === 0) {
      throw new BadRequestException({
        error: 'PASSWORD_REQUIRED',
        message: 'Portal password is required for member account creation.',
      });
    }
    const initialPassword = dto.portalPassword.trim();
    const passwordHash = await bcrypt.hash(initialPassword, 10);

    const pType = dto.paymentType === 'one_time' ? PaymentType.one_time : PaymentType.installment;
    const {
      installmentPlanData,
      downpaymentAmount,
      numberOfInstallments,
      paidAfterEvery,
      baseInstallmentAmount,
      roundingRemainder,
    } = this.computeInstallmentPlan(Number(plot.price), undefined, dto.installmentPlan, pType);

    const result = await this.prisma.withScopedSession(session, async (tx) => {
      // 1. Create Customer
      const customer = await tx.customer.create({
        data: {
          id: customerId,
          membershipNo: targetMembershipNo,
          fullName: dto.fullName.trim(),
          fatherOrHusbandName: dto.fatherOrHusbandName.trim(),
          cnic: dto.cnic.trim(),
          phone: dto.phone.trim(),
          email: dto.email.trim(),
          mailingAddress: dto.mailingAddress.trim(),
          nokName: dto.nokName.trim(),
          nokCnic: dto.nokCnic.trim(),
          registrationStatus: 'complete',
          credentialsPending: false,
          passwordHash,
          accountStatus: 'active',
        },
      });

      // 2. Create Booking
      const booking = await tx.booking.create({
        data: {
          id: bookingId,
          customerId: customer.id,
          plotId: plot.id,
          paymentType: pType,
          status: 'completed',
          registrationStatus: 'complete',
          bookingDate: now,
          confirmationDate: now,
          createdByAdminId: session.adminId || session.username,
          installmentPlan: installmentPlanData,
          paperInstallmentRef: dto.paperInstallmentRef?.trim() || null,
        },
      });

      // 3. Update Plot
      const targetPlotStatus = pType === PaymentType.one_time ? PlotStatus.allotted : PlotStatus.booked;

      await updatePlotStatus(tx, {
        plotId: plot.id,
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

      // 4. Supersede active reservations
      await tx.reservation.updateMany({
        where: { plotId: plot.id, status: 'active' },
        data: { status: 'superseded', supersededAt: now, supersededByBookingId: bookingId },
      });

      // 5. Statutory Fees
      const admFee = await tx.paymentRecord.create({
        data: {
          id: `fee-adm-${bookingId}`,
          bookingId,
          feeType: FeeType.admission_fee,
          dueDate: now,
          amount: 2000,
          paidAmount: 2000,
          status: PaymentStatus.paid,
        },
      });

      const subFee = await tx.paymentRecord.create({
        data: {
          id: `fee-sub-${bookingId}`,
          bookingId,
          feeType: FeeType.share_subscription_fee,
          dueDate: now,
          amount: 10000,
          paidAmount: 10000,
          status: PaymentStatus.paid,
        },
      });

      const paymentRecords = [admFee, subFee];

      // 6. Plot Price Payments
      if (pType === PaymentType.one_time) {
        const fullPay = await tx.paymentRecord.create({
          data: {
            id: `pay-one-${bookingId}`,
            bookingId,
            feeType: FeeType.plot_one_time,
            dueDate: now,
            amount: Number(plot.price),
            paidAmount: Number(plot.price),
            status: PaymentStatus.paid,
          },
        });
        paymentRecords.push(fullPay);
      } else {
        if (downpaymentAmount > 0) {
          const downRec = await tx.paymentRecord.create({
            data: {
              id: `pay-down-${bookingId}`,
              bookingId,
              feeType: FeeType.plot_downpayment,
              installmentNumber: 0,
              dueDate: now,
              amount: downpaymentAmount,
              paidAmount: downpaymentAmount,
              status: PaymentStatus.paid,
            },
          });
          paymentRecords.push(downRec);
        }

        const installmentDueDates = calculateInstallmentDueDates(now, numberOfInstallments, paidAfterEvery);

        for (let i = 1; i <= numberOfInstallments; i++) {
          const dueDate = installmentDueDates[i - 1];
          const currentInstAmount =
            i === numberOfInstallments ? baseInstallmentAmount + roundingRemainder : baseInstallmentAmount;

          const instRec = await tx.paymentRecord.create({
            data: {
              id: `pay-inst-${bookingId}-${i}`,
              bookingId,
              feeType: FeeType.plot_installment,
              installmentNumber: i,
              dueDate,
              amount: currentInstAmount,
              paidAmount: 0,
              status: PaymentStatus.pending,
            },
          });
          paymentRecords.push(instRec);
        }
      }

      // 7. Society Documents
      const confDoc = await tx.societyDocument.create({
        data: {
          id: `doc-${bookingId}-conf`,
          customerId: customer.id,
          bookingId,
          type: GeneratedDocType.booking_confirmation,
          fileName: `Booking_Confirmation_${targetMembershipNo}_${plot.plotNumber}.pdf`,
          fileUrl: `/documents/booking-confirmation-${bookingId}.pdf`,
          fileSizeKb: 1420,
        },
      });

      const agrDoc = await tx.societyDocument.create({
        data: {
          id: `doc-${bookingId}-agr`,
          customerId: customer.id,
          bookingId,
          type: GeneratedDocType.booking_agreement,
          fileName: `Booking_Agreement_${targetMembershipNo}_${plot.plotNumber}.pdf`,
          fileUrl: `/documents/booking-agreement-${bookingId}.pdf`,
          fileSizeKb: 1420,
        },
      });

      const rcptDoc = await tx.societyDocument.create({
        data: {
          id: `doc-${bookingId}-rcpt`,
          customerId: customer.id,
          bookingId,
          type: GeneratedDocType.payment_receipt,
          fileName: `Payment_Receipt_${targetMembershipNo}_${plot.plotNumber}.pdf`,
          fileUrl: `/documents/payment-receipt-${bookingId}.pdf`,
          fileSizeKb: 1420,
        },
      });

      const schDoc = await tx.societyDocument.create({
        data: {
          id: `doc-${bookingId}-sch`,
          customerId: customer.id,
          bookingId,
          type: GeneratedDocType.installment_schedule,
          fileName: `Installment_Schedule_${targetMembershipNo}_${plot.plotNumber}.pdf`,
          fileUrl: `/documents/installment-schedule-${bookingId}.pdf`,
          fileSizeKb: 1420,
        },
      });

      // 8. Audit Entry
      await tx.auditEntry.create({
        data: {
          actorId: session.adminId || session.username,
          actorName: session.fullName || session.username,
          actorRole: session.role,
          action: 'CUSTOMER_CREATED',
          entityType: 'customer',
          entityId: customer.id,
          details: `Admin ${session.fullName || session.username} created Member ${customer.fullName} (${customer.membershipNo}) with Booking on Plot ${plot.plotNumber}`,
          newValue: {
            membershipNo: customer.membershipNo,
            plotNumber: plot.plotNumber,
            totalPrice: Number(plot.price),
          },
        },
      });

      return {
        customer,
        booking,
        plot: updatedPlot,
        documents: [confDoc, agrDoc, rcptDoc, schDoc],
        payments: paymentRecords,
      };
    });

    await this.realtime.broadcast('customers', 'CUSTOMER_CREATED', { customerId });
    await this.realtime.broadcast(`block:${plot.blockId}`, 'PLOT_BOOKED', {
      plotId: plot.id,
      bookingId,
      customerId,
      bookedBy: session.adminId,
    });
    await this.realtime.broadcast('plots', 'PLOT_BOOKED', {
      plotId: plot.id,
      bookingId,
      customerId,
      bookedBy: session.adminId,
    });

    return {
      ok: true,
      customer: result.customer,
      booking: result.booking,
      credentials: {
        username: targetMembershipNo,
        password: initialPassword,
      },
    };
  }

  /**
   * 4. POST /customers/:id/bookings (Path B)
   * Add additional Plot Booking to an existing customer account.
   */
  async addBookingToCustomer(customerId: string, dto: AddBookingDto, session: any) {
    if (session.role !== 'super_admin' && !session.permissions?.can_create_customer) {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'You do not have permission to attach plot bookings.',
      });
    }

    const customer = await this.prisma.withScopedSession(session, async (tx) => {
      return tx.customer.findUnique({ where: { id: customerId } });
    });

    if (!customer) {
      throw new NotFoundException({ error: 'CUSTOMER_NOT_FOUND', message: 'Customer record not found.' });
    }

    if (customer.accountStatus === 'suspended') {
      throw new BadRequestException({
        error: 'CUSTOMER_SUSPENDED',
        message: 'Cannot attach new bookings: Customer account is currently suspended.',
      });
    }

    const plot = await this.getPlotWithScopeCheck(dto.plotId, session);

    const now = new Date();
    const bookingId = `book-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const pType = dto.paymentType === 'one_time' ? PaymentType.one_time : PaymentType.installment;

    const {
      installmentPlanData,
      downpaymentAmount,
      numberOfInstallments,
      paidAfterEvery,
      baseInstallmentAmount,
      roundingRemainder,
    } = this.computeInstallmentPlan(Number(plot.price), undefined, dto.installmentPlan, pType);

    const result = await this.prisma.withScopedSession(session, async (tx) => {
      // 1. Create Booking
      const booking = await tx.booking.create({
        data: {
          id: bookingId,
          customerId: customer.id,
          plotId: plot.id,
          paymentType: pType,
          status: 'completed',
          registrationStatus: 'complete',
          bookingDate: now,
          confirmationDate: now,
          createdByAdminId: session.adminId || session.username,
          installmentPlan: installmentPlanData,
          paperInstallmentRef: dto.paperInstallmentRef?.trim() || null,
        },
      });

      // 2. Update Plot
      const targetPlotStatus = pType === PaymentType.one_time ? PlotStatus.allotted : PlotStatus.booked;

      await updatePlotStatus(tx, {
        plotId: plot.id,
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

      // 3. Supersede active reservations
      await tx.reservation.updateMany({
        where: { plotId: plot.id, status: 'active' },
        data: { status: 'superseded', supersededAt: now, supersededByBookingId: bookingId },
      });

      // 4. Statutory Fees
      const admFee = await tx.paymentRecord.create({
        data: {
          id: `fee-adm-${bookingId}`,
          bookingId,
          feeType: FeeType.admission_fee,
          dueDate: now,
          amount: 2000,
          paidAmount: 2000,
          status: PaymentStatus.paid,
        },
      });

      const subFee = await tx.paymentRecord.create({
        data: {
          id: `fee-sub-${bookingId}`,
          bookingId,
          feeType: FeeType.share_subscription_fee,
          dueDate: now,
          amount: 10000,
          paidAmount: 10000,
          status: PaymentStatus.paid,
        },
      });

      const paymentRecords = [admFee, subFee];

      // 5. Plot Price Payments
      if (pType === PaymentType.one_time) {
        const fullPay = await tx.paymentRecord.create({
          data: {
            id: `pay-one-${bookingId}`,
            bookingId,
            feeType: FeeType.plot_one_time,
            dueDate: now,
            amount: Number(plot.price),
            paidAmount: Number(plot.price),
            status: PaymentStatus.paid,
          },
        });
        paymentRecords.push(fullPay);
      } else {
        if (downpaymentAmount > 0) {
          const downRec = await tx.paymentRecord.create({
            data: {
              id: `pay-down-${bookingId}`,
              bookingId,
              feeType: FeeType.plot_downpayment,
              installmentNumber: 0,
              dueDate: now,
              amount: downpaymentAmount,
              paidAmount: downpaymentAmount,
              status: PaymentStatus.paid,
            },
          });
          paymentRecords.push(downRec);
        }

        const installmentDueDates = calculateInstallmentDueDates(now, numberOfInstallments, paidAfterEvery);

        for (let i = 1; i <= numberOfInstallments; i++) {
          const dueDate = installmentDueDates[i - 1];
          const currentInstAmount =
            i === numberOfInstallments ? baseInstallmentAmount + roundingRemainder : baseInstallmentAmount;

          const instRec = await tx.paymentRecord.create({
            data: {
              id: `pay-inst-${bookingId}-${i}`,
              bookingId,
              feeType: FeeType.plot_installment,
              installmentNumber: i,
              dueDate,
              amount: currentInstAmount,
              paidAmount: 0,
              status: PaymentStatus.pending,
            },
          });
          paymentRecords.push(instRec);
        }
      }

      // 6. Society Documents
      const agrDoc = await tx.societyDocument.create({
        data: {
          id: `doc-${bookingId}-agr`,
          customerId: customer.id,
          bookingId,
          type: GeneratedDocType.booking_agreement,
          fileName: `Allotment_Agreement_${customer.membershipNo || 'Customer'}_${plot.plotNumber}.pdf`,
          fileUrl: `/documents/booking-agreement-${bookingId}.pdf`,
          fileSizeKb: 1420,
        },
      });

      const schDoc = await tx.societyDocument.create({
        data: {
          id: `doc-${bookingId}-sch`,
          customerId: customer.id,
          bookingId,
          type: GeneratedDocType.installment_schedule,
          fileName: `Installment_Schedule_${customer.membershipNo || 'Customer'}_${plot.plotNumber}.pdf`,
          fileUrl: `/documents/installment-schedule-${bookingId}.pdf`,
          fileSizeKb: 1420,
        },
      });

      // 7. Audit Entry
      await tx.auditEntry.create({
        data: {
          actorId: session.adminId || session.username,
          actorName: session.fullName || session.username,
          actorRole: session.role,
          action: 'PLOT_BOOKED',
          entityType: 'booking',
          entityId: bookingId,
          details: `Admin ${session.fullName || session.username} attached Booking for Plot ${plot.plotNumber} to existing Member ${customer.fullName} (${customer.membershipNo})`,
          newValue: {
            customerId: customer.id,
            plotNumber: plot.plotNumber,
            totalPrice: Number(plot.price),
          },
        },
      });

      return { booking, plot: updatedPlot, documents: [agrDoc, schDoc], payments: paymentRecords };
    });

    await this.realtime.broadcast(`block:${plot.blockId}`, 'PLOT_BOOKED', {
      plotId: plot.id,
      bookingId,
      customerId: customer.id,
      bookedBy: session.adminId,
    });
    await this.realtime.broadcast('plots', 'PLOT_BOOKED', {
      plotId: plot.id,
      bookingId,
      customerId: customer.id,
      bookedBy: session.adminId,
    });
    await this.realtime.broadcast('customers', 'CUSTOMER_UPDATED', { customerId: customer.id });

    return {
      ok: true,
      booking: result.booking,
    };
  }

  /**
   * 5. POST /customers/:id/strikes
   * Assign an administrative strike to a customer.
   */
  async assignStrike(id: string, dto: AssignStrikeDto, session: any) {
    const isSuper = session.role === 'super_admin';
    const canAct = Boolean(
      session.permissions?.can_verify_receipts ||
      session.permissions?.can_view_customers,
    );

    if (!isSuper && !canAct) {
      throw new ForbiddenException({
        reason: 'PERMISSION_DENIED',
        error: 'FORBIDDEN',
        message: 'You do not have permission to assign strikes to customer accounts.',
      });
    }

    const customer = await this.prisma.withScopedSession(session, async (tx) => {
      return tx.customer.findUnique({ where: { id } });
    });

    if (!customer) {
      throw new NotFoundException({ error: 'CUSTOMER_NOT_FOUND', message: 'Customer record not found.' });
    }

    const reasonTrimmed = dto.reason.trim();
    if (!reasonTrimmed) {
      throw new BadRequestException({ error: 'REASON_REQUIRED', message: 'A reason must be provided to assign a strike.' });
    }

    const result = await this.prisma.withScopedSession(session, async (tx) => {
      const strikeId = `strike-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const strike = await tx.customerStrike.create({
        data: {
          id: strikeId,
          customerId: customer.id,
          reason: reasonTrimmed,
          receiptId: dto.receiptId || null,
          assignedBy: session.fullName || session.username,
        },
      });

      const updatedCustomer = await tx.customer.update({
        where: { id: customer.id },
        data: { strikeCount: { increment: 1 } },
      });

      await tx.auditEntry.create({
        data: {
          actorId: session.adminId || session.username,
          actorName: session.fullName || session.username,
          actorRole: session.role,
          action: 'STRIKE_ASSIGNED',
          entityType: 'strike',
          entityId: customer.id,
          details: `Assigned Strike #${updatedCustomer.strikeCount} to Member ${customer.fullName} (${customer.membershipNo || customer.id}). Reason: ${reasonTrimmed}`,
          newValue: { strikeId, reason: reasonTrimmed, strikeCount: updatedCustomer.strikeCount },
        },
      });

      return { strike, customer: updatedCustomer };
    });

    await this.realtime.broadcast('customers', 'STRIKE_ASSIGNED', {
      customerId: customer.id,
      strikeCount: result.customer.strikeCount,
      strike: result.strike,
    });
    await this.realtime.broadcast('customers', 'CUSTOMER_UPDATED', { customerId: customer.id });

    return {
      ok: true,
      strike: result.strike,
      strikeCount: result.customer.strikeCount,
      message: `Strike #${result.customer.strikeCount} assigned to ${customer.fullName} successfully.`,
    };
  }

  /**
   * 6. POST /customers/:id/suspend
   * Suspend or reactivate a Customer account.
   */
  async toggleSuspension(id: string, dto: ToggleSuspensionDto, session: any) {
    const isSuper = session.role === 'super_admin';
    const canAct = Boolean(session.permissions?.can_view_customers);

    if (!isSuper && !canAct) {
      throw new ForbiddenException({
        reason: 'PERMISSION_DENIED',
        error: 'FORBIDDEN',
        message: 'You do not have permission to modify customer account status.',
      });
    }

    const customer = await this.prisma.withScopedSession(session, async (tx) => {
      return tx.customer.findUnique({ where: { id } });
    });

    if (!customer) {
      throw new NotFoundException({ error: 'CUSTOMER_NOT_FOUND', message: 'Customer record not found.' });
    }

    const newStatus = dto.action === 'suspend' ? 'suspended' : 'active';

    const result = await this.prisma.withScopedSession(session, async (tx) => {
      const updated = await tx.customer.update({
        where: { id: customer.id },
        data: { accountStatus: newStatus },
      });

      await tx.auditEntry.create({
        data: {
          actorId: session.adminId || session.username,
          actorName: session.fullName || session.username,
          actorRole: session.role,
          action: dto.action === 'suspend' ? 'CUSTOMER_SUSPENDED' : 'CUSTOMER_REINSTATED',
          entityType: 'customer',
          entityId: customer.id,
          details: `Account for ${customer.fullName} (${customer.membershipNo || customer.id}) set to '${newStatus}' by ${session.fullName || session.username}. Reason: ${dto.reason || 'None specified'}`,
          newValue: { accountStatus: newStatus, reason: dto.reason || null },
        },
      });

      return updated;
    });

    await this.realtime.broadcast('customers', 'CUSTOMER_UPDATED', {
      customerId: customer.id,
      accountStatus: newStatus,
    });

    return {
      ok: true,
      customer: result,
      message: `Customer account successfully ${dto.action === 'suspend' ? 'suspended' : 'reactivated'}.`,
    };
  }

  /**
   * POST /customers/:id/documents
   * Manual upload / attachment of CustomerDocument (can_create_customer or Super Admin).
   */
  async uploadDocument(customerId: string, dto: UploadCustomerDocumentDto, session: any) {
    const isSuper = session.role === 'super_admin';
    const hasPerm = isSuper || Boolean(session.permissions?.can_create_customer);
    if (!hasPerm) {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'You do not have permission to upload customer documents.',
      });
    }

    const customer = await this.prisma.withScopedSession(session, async (tx) => {
      return tx.customer.findUnique({
        where: { id: customerId },
        include: { bookings: { include: { plot: true } } },
      });
    });

    if (!customer) {
      throw new NotFoundException({
        error: 'CUSTOMER_NOT_FOUND',
        message: 'Customer not found.',
      });
    }

    if (!isSuper) {
      let blockIdToCheck: string | undefined;
      if (dto.bookingId) {
        const b = customer.bookings.find((bk) => bk.id === dto.bookingId);
        if (b) blockIdToCheck = b.plot.blockId;
      } else if (customer.bookings.length > 0) {
        blockIdToCheck = customer.bookings[0].plot.blockId;
      }

      if (blockIdToCheck && !session.assignedBlocks?.includes(blockIdToCheck)) {
        throw new ForbiddenException({
          error: 'OUT_OF_SCOPE',
          message: 'Customer booking is outside your assigned administrative scope.',
        });
      }
    }

    if (dto.type === DocumentType.other && (!dto.label || !dto.label.trim())) {
      throw new BadRequestException({
        error: 'LABEL_REQUIRED',
        message: 'A descriptive label is required when document type is "other".',
      });
    }

    const doc = await this.prisma.withScopedSession(session, async (tx) => {
      const created = await tx.customerDocument.create({
        data: {
          customerId: customer.id,
          bookingId: dto.bookingId || null,
          type: dto.type,
          label: dto.type === DocumentType.other ? dto.label?.trim() : null,
          fileUrl: dto.fileUrl,
          fileName: dto.fileName,
          fileSizeKb: dto.fileSizeKb || 1,
          uploadedById: session.adminId || session.id || session.username || 'admin',
        },
      });

      await tx.auditEntry.create({
        data: {
          actorId: session.adminId || session.id || session.username || 'admin',
          actorName: session.fullName || session.username || 'Administrator',
          actorRole: session.role || 'admin',
          action: 'CUSTOMER_DOCUMENT_UPLOADED',
          entityType: 'document',
          entityId: created.id,
          details: `Uploaded ${created.type} document "${created.fileName}" for Customer ${customer.fullName} (${customer.membershipNo || customer.id})`,
        },
      });

      return created;
    });

    return { ok: true, document: doc };
  }

  /**
   * DELETE /customers/:id/documents/:docId
   * Delete CustomerDocument attachment (can_create_customer or Super Admin).
   */
  async deleteDocument(customerId: string | null, docId: string, session: any) {
    const isSuper = session.role === 'super_admin';
    const hasPerm = isSuper || Boolean(session.permissions?.can_create_customer);
    if (!hasPerm) {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'You do not have permission to delete customer documents.',
      });
    }

    const doc = await this.prisma.withScopedSession(session, async (tx) => {
      return tx.customerDocument.findUnique({
        where: { id: docId },
        include: { customer: { include: { bookings: { include: { plot: true } } } } },
      });
    });

    if (!doc || (customerId && doc.customerId !== customerId)) {
      throw new NotFoundException({
        error: 'DOCUMENT_NOT_FOUND',
        message: 'Document record not found.',
      });
    }

    if (!isSuper) {
      let blockIdToCheck: string | undefined;
      if (doc.bookingId) {
        const b = doc.customer.bookings.find((bk) => bk.id === doc.bookingId);
        if (b) blockIdToCheck = b.plot.blockId;
      } else if (doc.customer.bookings.length > 0) {
        blockIdToCheck = doc.customer.bookings[0].plot.blockId;
      }

      if (blockIdToCheck && !session.assignedBlocks?.includes(blockIdToCheck)) {
        throw new ForbiddenException({
          error: 'OUT_OF_SCOPE',
          message: 'Cannot delete document: Associated plot is outside your assigned administrative scope.',
        });
      }
    }

    await this.prisma.withScopedSession(session, async (tx) => {
      await tx.customerDocument.delete({ where: { id: docId } });
      await tx.auditEntry.create({
        data: {
          actorId: session.adminId || session.id || session.username || 'admin',
          actorName: session.fullName || session.username || 'Administrator',
          actorRole: session.role || 'admin',
          action: 'CUSTOMER_DOCUMENT_DELETED',
          entityType: 'document',
          entityId: docId,
          details: `Deleted ${doc.type} document "${doc.fileName}" (ID: ${docId})`,
        },
      });
    });

    return { ok: true, message: 'Document deleted successfully.' };
  }

  /**
   * POST /customers/:id/accept-terms
   * Record customer terms and conditions acceptance upon first portal login.
   */
  async acceptTerms(id: string, session: any) {
    if (session.role === 'customer' && session.customerId !== id) {
      throw new ForbiddenException({
        error: 'IDENTITY_REJECTED',
        message: 'You can only accept terms for your own account.',
      });
    }

    const updated = await this.prisma.withScopedSession(session, async (tx) => {
      return tx.customer.update({
        where: { id },
        data: {
          termsAccepted: true,
          termsAcceptedAt: new Date(),
        },
      });
    });

    return { ok: true, customer: updated };
  }

  /**
   * PATCH /customers/:id/profile
   * Self-service profile update for logged-in customer.
   */
  async updateProfile(id: string, dto: UpdateCustomerProfileDto, session: any) {
    if (session.role === 'customer' && session.customerId !== id) {
      throw new ForbiddenException({
        error: 'IDENTITY_REJECTED',
        message: 'You can only update your own customer profile.',
      });
    }

    const existing = await this.prisma.withScopedSession(session, async (tx) => {
      return tx.customer.findUnique({ where: { id } });
    });

    if (!existing) {
      throw new NotFoundException({
        error: 'CUSTOMER_NOT_FOUND',
        message: 'Customer not found.',
      });
    }

    if (session.role !== 'super_admin' && session.role !== 'customer') {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'You do not have permission to update this customer profile.',
      });
    }

    const updated = await this.prisma.withScopedSession(session, async (tx) => {
      const cust = await tx.customer.update({
        where: { id },
        data: {
          phone: dto.phone !== undefined ? dto.phone.trim() : undefined,
          email: dto.email !== undefined ? dto.email.trim() : undefined,
          mailingAddress: dto.mailingAddress !== undefined ? dto.mailingAddress.trim() : undefined,
          city: dto.city !== undefined ? dto.city.trim() : undefined,
          fatherOrHusbandName: dto.fatherOrHusbandName !== undefined ? dto.fatherOrHusbandName.trim() : undefined,
          nokName: dto.nokName !== undefined ? dto.nokName.trim() : undefined,
          nokCnic: dto.nokCnic !== undefined ? dto.nokCnic.trim() : undefined,
        },
      });

      await tx.auditEntry.create({
        data: {
          actorId: session.customerId || session.adminId || session.username,
          actorName: session.fullName || session.username,
          actorRole: session.role,
          action: 'CUSTOMER_PROFILE_UPDATED',
          entityType: 'customer',
          entityId: id,
          details: `Customer ${cust.fullName} profile updated`,
          oldValue: {
            phone: existing.phone,
            email: existing.email,
            mailingAddress: existing.mailingAddress,
            city: existing.city,
          },
          newValue: {
            phone: cust.phone,
            email: cust.email,
            mailingAddress: cust.mailingAddress,
            city: cust.city,
          },
        },
      });

      return cust;
    });

    return { ok: true, customer: updated };
  }

  /**
   * POST /customers/:id/change-password
   * Customer password change self-service.
   */
  async changePassword(id: string, dto: ChangeCustomerPasswordDto, session: any) {
    if (session.role === 'customer' && session.customerId !== id) {
      throw new ForbiddenException({
        error: 'IDENTITY_REJECTED',
        message: 'You can only change your own password.',
      });
    }

    const customer = await this.prisma.withScopedSession(session, async (tx) => {
      return tx.customer.findUnique({ where: { id } });
    });

    if (!customer) {
      throw new NotFoundException({
        error: 'CUSTOMER_NOT_FOUND',
        message: 'Customer not found.',
      });
    }

    if (!customer.passwordHash) {
      throw new BadRequestException({
        error: 'NO_PASSWORD_SET',
        message: 'No existing password has been set for this account.',
      });
    }

    const isValid = await bcrypt.compare(dto.oldPassword, customer.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException({
        error: 'INVALID_CREDENTIALS',
        message: 'Current password does not match.',
      });
    }

    const newHash = await bcrypt.hash(dto.newPassword.trim(), 10);

    await this.prisma.withScopedSession(session, async (tx) => {
      await tx.customer.update({
        where: { id },
        data: {
          passwordHash: newHash,
          credentialsPending: false,
        },
      });

      await tx.auditEntry.create({
        data: {
          actorId: session.customerId || session.adminId || session.username,
          actorName: session.fullName || session.username,
          actorRole: session.role,
          action: 'CUSTOMER_PASSWORD_CHANGED',
          entityType: 'customer',
          entityId: id,
          details: `Password changed for customer ${customer.fullName} (${customer.membershipNo})`,
        },
      });
    });

    return { ok: true, message: 'Password changed successfully.' };
  }
}


