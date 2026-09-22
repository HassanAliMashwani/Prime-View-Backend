import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SubmitReceiptDto } from './dto/submit-receipt.dto';
import { VerifyReceiptDto } from './dto/verify-receipt.dto';
import { RejectReceiptDto } from './dto/reject-receipt.dto';
import { ReceiptStatus } from '@prisma/client';

import { StorageService } from '../storage/storage.service';

@Injectable()
export class ReceiptsService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeService,
    private storageService: StorageService,
  ) {}

  /**
   * 1. POST /receipts
   * Customer submits a deposit receipt for verification.
   */
  async submitPaymentReceipt(dto: SubmitReceiptDto, session: any) {
    // Resolve customer identity
    const customerId = session.customerId || session.id || dto.customerId;
    if (!customerId) {
      throw new BadRequestException({
        error: 'CUSTOMER_REQUIRED',
        message: 'Customer ID could not be identified.',
      });
    }

    const customer = await this.prisma.withScopedSession(session, async (tx) => {
      return tx.customer.findUnique({ where: { id: customerId } });
    });

    if (!customer) {
      throw new NotFoundException({
        error: 'CUSTOMER_NOT_FOUND',
        message: 'Customer account not found.',
      });
    }

    const bank = (dto.depositoryBank || dto.bankName || '').trim();
    if (!bank) {
      throw new BadRequestException({
        error: 'BANK_REQUIRED',
        message: 'Depository Bank is required.',
      });
    }

    // Post-Upload Verification Step (Method B - Doc 10 §6)
    if (dto.receiptFileUrl) {
      const rawKey = dto.receiptFileUrl.includes('receipts:')
        ? dto.receiptFileUrl.split('receipts:')[1]
        : dto.receiptFileUrl.split('/receipts/')[1] || dto.receiptFileUrl;
      const cleanKey = rawKey.split('?')[0].trim();
      const fileCheck = await this.storageService.verifyUploadedObject('receipts', cleanKey, 'image/jpeg');
      if (!fileCheck.valid) {
        throw new BadRequestException({
          error: fileCheck.error || 'INVALID_UPLOADED_FILE',
          message: `Receipt upload rejected: ${fileCheck.error}`,
        });
      }
    }

    // Verify plot ownership
    const booking = await this.prisma.withScopedSession(session, async (tx) => {
      return tx.booking.findFirst({
        where: {
          customerId: customer.id,
          plotId: dto.plotId,
          status: 'active',
        },
        include: {
          plot: true,
          payments: true,
        },
      });
    });

    if (!booking) {
      throw new ForbiddenException({
        error: 'UNAUTHORIZED_PLOT',
        message: 'You do not own this property.',
      });
    }

    // Identify target payment record
    let targetPaymentRecord: any = null;
    if (dto.paymentType === 'installment') {
      const dueStatuses = ['pending', 'overdue', 'partially_paid'];
      targetPaymentRecord = booking.payments
        .filter((p) => p.feeType === 'plot_installment' && dueStatuses.includes(p.status))
        .sort((a, b) => {
          if (a.dueDate && b.dueDate) {
            const cmp = new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
            if (cmp !== 0) return cmp;
          }
          return (a.installmentNumber || 0) - (b.installmentNumber || 0);
        })[0];

      if (!targetPaymentRecord) {
        throw new BadRequestException({
          error: 'NO_OUTSTANDING_INSTALLMENTS',
          message: 'No outstanding installments found for this plot.',
        });
      }
    } else if (dto.paymentType === 'one_time') {
      targetPaymentRecord = booking.payments.find(
        (p) => p.feeType === 'plot_one_time',
      );

      if (targetPaymentRecord) {
        // Allow exactly ONE record receipt for an already-settled one-time payment
        const existingRecordReceipt = await this.prisma.withScopedSession(session, async (tx) => {
          return tx.receiptSubmission.findFirst({
            where: {
              bookingId: booking.id,
              paymentRecordId: targetPaymentRecord.id,
            },
          });
        });

        if (existingRecordReceipt) {
          throw new ConflictException({
            error: 'ALREADY_RECORDED',
            message: 'A record receipt has already been submitted for this payment.',
          });
        }
      }
    }

    // Check for existing pending receipt submission
    const pendingReceipt = await this.prisma.withScopedSession(session, async (tx) => {
      return tx.receiptSubmission.findFirst({
        where: {
          customerId: customer.id,
          bookingId: booking.id,
          status: 'pending',
          ...(dto.paymentType === 'one_time' && targetPaymentRecord ? { paymentRecordId: targetPaymentRecord.id } : {}),
        },
      });
    });

    if (pendingReceipt) {
      throw new ConflictException({
        error: 'RECEIPT_ALREADY_PENDING',
        message:
          dto.paymentType === 'installment'
            ? 'A receipt for this plot is already pending verification.'
            : 'A receipt for this plot purchase is already pending verification by the society desk.',
      });
    }

    const receiptId = `rcpt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date();
    const paymentDateParsed = new Date(dto.paymentDate);

    const result = await this.prisma.withScopedSession(session, async (tx) => {
      const created = await tx.receiptSubmission.create({
        data: {
          id: receiptId,
          customerId: customer.id,
          bookingId: booking.id,
          paymentRecordId: targetPaymentRecord ? targetPaymentRecord.id : null,
          depositoryBank: bank,
          transactionRef: dto.transactionRef.trim(),
          paymentDate: isNaN(paymentDateParsed.getTime()) ? now : paymentDateParsed,
          amount: dto.amount,
          receiptFileUrl: dto.receiptFileUrl.trim(),
          status: 'pending',
          uploadedAt: now,
        },
      });

      await tx.auditEntry.create({
        data: {
          actorId: customer.id,
          actorName: customer.fullName,
          actorRole: 'customer',
          action: 'RECEIPT_SUBMITTED',
          entityType: 'receipt',
          entityId: receiptId,
          details: `Customer submitted deposit receipt for Plot ${booking.plot.plotNumber} (${dto.paymentType === 'installment' ? `Inst. #${dto.installmentNumber}` : 'Full Payment'}) - PKR ${Number(dto.amount).toLocaleString()} via Depository Bank: ${bank}`,
          newValue: {
            receiptId,
            plotNumber: booking.plot.plotNumber,
            amount: dto.amount,
            depositoryBank: bank,
          },
        },
      });

      return created;
    });

    await this.realtime.broadcast('receipts', 'RECEIPT_SUBMITTED', {
      receiptId: result.id,
      customerId: customer.id,
      plotId: dto.plotId,
      amount: dto.amount,
    });

    return {
      ok: true,
      receipt: {
        ...result,
        customerName: customer.fullName,
        membershipNo: customer.membershipNo,
        plotNumber: booking.plot.plotNumber,
        blockName: booking.plot.blockId,
        paymentType: dto.paymentType,
        installmentNumber: dto.paymentType === 'installment' && targetPaymentRecord ? targetPaymentRecord.installmentNumber : dto.installmentNumber,
      },
    };
  }

  /**
   * 2. GET /receipts
   * Admin queue of receipts, block-scoped for sub-admins, enriched with strikes.
   */
  async getAdminReceipts(statusFilter: string | undefined, session: any) {
    const isSuper = session.role === 'super_admin';
    const hasAuth = Boolean(session.permissions?.can_verify_receipts);

    if (!isSuper && !hasAuth) {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'You do not have Receipt Verification Authority.',
      });
    }

    const where: any = {};
    if (statusFilter && statusFilter !== 'all') {
      where.status = statusFilter as ReceiptStatus;
    }

    const receipts = await this.prisma.withScopedSession(session, async (tx) => {
      return tx.receiptSubmission.findMany({
        where,
        include: {
          customer: {
            select: {
              id: true,
              fullName: true,
              membershipNo: true,
              phone: true,
              cnic: true,
              strikeCount: true,
              strikes: {
                orderBy: { assignedAt: 'desc' },
              },
            },
          },
        },
        orderBy: { uploadedAt: 'desc' },
      });
    });

    const enriched = await Promise.all(receipts.map(async (r) => {
      const booking = await this.prisma.booking.findUnique({
        where: { id: r.bookingId },
        include: { plot: true }
      });
      const paymentRecord = r.paymentRecordId ? await this.prisma.paymentRecord.findUnique({
        where: { id: r.paymentRecordId }
      }) : null;

      return {
        ...r,
        customerName: r.customer?.fullName,
        membershipNo: r.customer?.membershipNo,
        customerPhone: r.customer?.phone,
        customerCnic: r.customer?.cnic,
        customerStrikeCount: r.customer?.strikeCount || 0,
        customerStrikeHistory: r.customer?.strikes || [],
        plotId: booking?.plot?.id,
        plotNumber: booking?.plot?.plotNumber,
        blockName: booking?.plot?.blockId,
        paymentType: booking?.paymentType,
        installmentNumber: paymentRecord?.installmentNumber,
      };
    }));

    return { ok: true, receipts: enriched };
  }

  /**
   * 3. GET /receipts/me
   * Retrieve receipts submitted by the authenticated customer.
   */
  async getCustomerReceipts(sessionOrId: any) {
    const session = typeof sessionOrId === 'object' && sessionOrId !== null
      ? sessionOrId
      : { role: 'customer', customerId: String(sessionOrId) };
    const customerId = session.customerId || session.id;
    const receipts = await this.prisma.withScopedSession(session, async (tx) => {
      return tx.receiptSubmission.findMany({
        where: { customerId },
        orderBy: { uploadedAt: 'desc' },
      });
    });

    const enriched = await Promise.all(receipts.map(async (r) => {
      const booking = await this.prisma.booking.findUnique({
        where: { id: r.bookingId },
        include: { plot: true }
      });
      const paymentRecord = r.paymentRecordId ? await this.prisma.paymentRecord.findUnique({
        where: { id: r.paymentRecordId }
      }) : null;

      return {
        ...r,
        plotId: booking?.plot?.id,
        plotNumber: booking?.plot?.plotNumber,
        blockName: booking?.plot?.blockId,
        paymentType: booking?.paymentType,
        installmentNumber: paymentRecord?.installmentNumber,
      };
    }));

    return { ok: true, receipts: enriched };
  }

  /**
   * 4. POST /receipts/:id/verify
   * Verify and approve a submitted payment receipt.
   * Generates official two-part slip, reconciles PaymentRecord, and logs audit.
   */
  async verifyReceipt(receiptId: string, dto: VerifyReceiptDto, session: any) {
    const isSuper = session.role === 'super_admin';
    const hasAuth = Boolean(session.permissions?.can_verify_receipts);

    if (!isSuper && !hasAuth) {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'You do not have Receipt Verification Authority to approve payment slips.',
      });
    }

    const receipt = await this.prisma.withScopedSession({ role: 'super_admin' }, async (tx) => {
      return tx.receiptSubmission.findUnique({
        where: { id: receiptId },
        include: {
          customer: true,
        },
      });
    });

    if (!receipt) {
      throw new NotFoundException({
        error: 'RECEIPT_NOT_FOUND',
        message: 'Receipt submission not found.',
      });
    }

    if (receipt.status !== 'pending') {
      throw new ConflictException({
        error: 'ALREADY_PROCESSED',
        message: `Receipt has already been ${receipt.status}.`,
      });
    }

    const now = new Date();
    const year = now.getFullYear();
    const randomSerial = Math.floor(1000 + Math.random() * 9000);
    const slipNumber = `PV-SLIP-${year}-${randomSerial}`;
    const hexA = Math.random().toString(16).substring(2, 6).toUpperCase();
    const hexB = Math.random().toString(16).substring(2, 6).toUpperCase();
    const securityHash = `PV-SEC-${hexA}-${hexB}-${Date.now().toString().slice(-4)}`;

    const result = await this.prisma.withScopedSession(session, async (tx) => {
      // 1. Update Receipt
      const updatedReceipt = await tx.receiptSubmission.update({
        where: { id: receiptId },
        data: {
          status: 'verified',
          verifiedByAdminId: session.adminId || session.username,
          verifiedAt: now,
          slipNumber,
          securityHash,
        },
      });

      // 2. Reconcile PaymentRecord (only if not already paid/settled, e.g. plot_one_time documentation receipt)
      if (receipt.paymentRecordId) {
        const currentPr = await tx.paymentRecord.findUnique({
          where: { id: receipt.paymentRecordId },
        });
        if (currentPr && currentPr.status !== 'paid') {
          await tx.paymentRecord.update({
            where: { id: receipt.paymentRecordId },
            data: {
              status: 'paid',
              paidAmount: receipt.amount,
            },
          });
        }
      }

      // 3. Create Audit Log
      await tx.auditEntry.create({
        data: {
          actorId: session.adminId || session.username,
          actorName: session.fullName || session.username,
          actorRole: session.role,
          action: 'RECEIPT_VERIFIED',
          entityType: 'receipt',
          entityId: receiptId,
          details: `Verified payment receipt ${receiptId} (${slipNumber}) for Member ${receipt.customer?.fullName || receipt.customerId} - PKR ${Number(receipt.amount).toLocaleString()}`,
          newValue: {
            slipNumber,
            securityHash,
            verifiedBy: session.fullName || session.username,
          },
        },
      });

      return updatedReceipt;
    });

    await this.realtime.broadcast('receipts', 'RECEIPT_VERIFIED', {
      receiptId: result.id,
      customerId: receipt.customerId,
      slipNumber,
    });

    await this.realtime.broadcast('plots', 'PAYMENT_RECORD_UPDATED', {
      customerId: receipt.customerId,
      bookingId: receipt.bookingId,
    });

    return {
      ok: true,
      receipt: {
        ...result,
        slip: {
          slipNumber,
          securityHash,
          generatedAt: now.toISOString(),
          societyAuthorityStamp: `OFFICIAL SOCIETY VERIFICATION • REG NO 411 KPK • VERIFIED BY ${(session.fullName || session.username).toUpperCase()}`,
        },
      },
    };
  }

  /**
   * 5. POST /receipts/:id/reject
   * Reject a submitted payment receipt with reason.
   * Optionally assigns a strike to the member in the same transaction.
   */
  async rejectReceipt(receiptId: string, dto: RejectReceiptDto, session: any) {
    const isSuper = session.role === 'super_admin';
    const hasAuth = Boolean(session.permissions?.can_verify_receipts);

    if (!isSuper && !hasAuth) {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'You do not have Receipt Verification Authority to reject receipts.',
      });
    }

    const receipt = await this.prisma.withScopedSession({ role: 'super_admin' }, async (tx) => {
      return tx.receiptSubmission.findUnique({
        where: { id: receiptId },
        include: {
          customer: true,
        },
      });
    });

    if (!receipt) {
      throw new NotFoundException({
        error: 'RECEIPT_NOT_FOUND',
        message: 'Receipt submission not found.',
      });
    }

    if (receipt.status !== 'pending') {
      throw new ConflictException({
        error: 'ALREADY_PROCESSED',
        message: `Receipt has already been ${receipt.status}.`,
      });
    }

    const now = new Date();
    const reasonStr = (dto.reason || 'Payment details could not be reconciled with bank statements.').trim();
    const strikeReasonStr = (dto.strikeReason || reasonStr).trim();

    const result = await this.prisma.withScopedSession(session, async (tx) => {
      // 1. Update Receipt
      const updatedReceipt = await tx.receiptSubmission.update({
        where: { id: receiptId },
        data: {
          status: 'rejected',
          rejectionReason: reasonStr,
          verifiedByAdminId: session.adminId || session.username,
          verifiedAt: now,
        },
      });

      let strikeAssigned = false;
      let newStrikeCount = receipt.customer?.strikeCount || 0;

      // 2. Conditionally Assign Strike
      if (dto.assignStrike) {
        newStrikeCount += 1;
        const strikeId = `strike-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

        await tx.customerStrike.create({
          data: {
            id: strikeId,
            customerId: receipt.customerId,
            reason: strikeReasonStr,
            assignedBy: session.fullName || session.username,
            assignedAt: now,
            receiptId: receipt.id,
          },
        });

        await tx.customer.update({
          where: { id: receipt.customerId },
          data: { strikeCount: { increment: 1 } },
        });

        await tx.auditEntry.create({
          data: {
            actorId: session.adminId || session.username,
            actorName: session.fullName || session.username,
            actorRole: session.role,
            action: 'STRIKE_ASSIGNED',
            entityType: 'strike',
            entityId: receipt.customerId,
            details: `Assigned strike #${newStrikeCount} to Member ${receipt.customer?.fullName || receipt.customerId} upon receipt rejection. Reason: ${strikeReasonStr}`,
          },
        });

        strikeAssigned = true;
      }

      // 3. Create Audit Entry for Rejection
      await tx.auditEntry.create({
        data: {
          actorId: session.adminId || session.username,
          actorName: session.fullName || session.username,
          actorRole: session.role,
          action: 'RECEIPT_REJECTED',
          entityType: 'receipt',
          entityId: receiptId,
          details: `Rejected receipt ${receiptId} for Member ${receipt.customer?.fullName || receipt.customerId}. Reason: ${reasonStr}${strikeAssigned ? ' (Strike assigned)' : ''}`,
        },
      });

      return { receipt: updatedReceipt, strikeAssigned, strikeCount: newStrikeCount };
    });

    if (result.strikeAssigned) {
      await this.realtime.broadcast('customers', 'STRIKE_ASSIGNED', {
        customerId: receipt.customerId,
        strikeCount: result.strikeCount,
        receiptId: receipt.id,
      });
    }

    await this.realtime.broadcast('receipts', 'RECEIPT_REJECTED', {
      receiptId: receipt.id,
      customerId: receipt.customerId,
    });

    return {
      ok: true,
      receipt: result.receipt,
      strikeAssigned: result.strikeAssigned,
    };
  }
  /**
   * 6. GET /receipts/verify/:slipNumber (PUBLIC)
   * Public endpoint to verify a receipt slip without authentication.
   */
  async publicVerifySlip(slipNumber: string) {
    const receipt = await this.prisma.withScopedSession({ role: 'super_admin' }, async (tx) => {
      return tx.receiptSubmission.findUnique({
        where: { slipNumber },
        include: {
          customer: {
            select: { fullName: true }
          }
        },
      });
    });

    if (!receipt) {
      return { exists: false, status: 'not_found' };
    }

    // Mask customer name (e.g. "Usman K.")
    let maskedName = 'Unknown';
    if (receipt.customer?.fullName) {
      const parts = receipt.customer.fullName.trim().split(/\s+/);
      if (parts.length > 1) {
        maskedName = `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
      } else {
        maskedName = `${parts[0]}`;
      }
    }

    return {
      exists: true,
      status: receipt.status,
      amount: receipt.amount,
      paymentDate: receipt.paymentDate,
      customerContext: maskedName,
    };
  }
}
