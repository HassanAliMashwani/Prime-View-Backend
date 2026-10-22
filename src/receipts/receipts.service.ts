import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  UnprocessableEntityException,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SubmitReceiptDto } from './dto/submit-receipt.dto';
import { VerifyReceiptDto } from './dto/verify-receipt.dto';
import { RejectReceiptDto } from './dto/reject-receipt.dto';
import { CancelReceiptDto } from './dto/cancel-receipt.dto';
import { Prisma, ReceiptStatus, PlotStatus } from '@prisma/client';

import { StorageService } from '../storage/storage.service';
import { allocateBalloon, PaymentRecordRow } from './balloon-engine';
import { updatePlotStatus, maybeAllotIfFullyPaid } from '../plots/update-plot-status';
import { generateSlipNumber } from './receipt-number.generator';

export function stripRoleFromOfficerName(name?: string | null): string {
  if (!name) return '';
  return name
    .replace(/\s*\((?:super\s*admin(?:istrator)?|sub\s*admin(?:istrator)?)\)\s*$/i, '')
    .trim();
}

export function formatCanonicalVal(val: any): string {
  if (val === null || val === undefined) {
    return '<NULL>';
  }
  return String(val);
}

export function toAmountPaisa(amount: any): string {
  if (amount === null || amount === undefined) {
    return '<NULL>';
  }
  const dec = new Prisma.Decimal(amount);
  return dec.mul(100).toFixed(0);
}

export function formatPaymentDate(date: any): string {
  if (!date) return '<NULL>';
  if (date instanceof Date) {
    return date.toISOString().split('T')[0];
  }
  const str = String(date).trim();
  if (!str) return '<NULL>';
  return str.split('T')[0];
}

export function buildReceiptCanonicalString(params: {
  receiptId: any;
  slipNumber: any;
  memberId: any;
  memberName: any;
  membershipNumber: any;
  amount: any;
  paymentDate: any;
  plotId: any;
  plotNumber: any;
  paymentRecordId: any;
  issuedByAdminId: any;
  issuedByName: any;
  issuedAt: any;
}): string {
  const formatIssuedAt = (d: any) => {
    if (!d) return '<NULL>';
    if (d instanceof Date) return d.toISOString();
    const s = String(d).trim();
    return s || '<NULL>';
  };

  return [
    'v=1',
    `receiptId=${formatCanonicalVal(params.receiptId)}`,
    `slipNumber=${formatCanonicalVal(params.slipNumber)}`,
    `memberId=${formatCanonicalVal(params.memberId)}`,
    `memberName=${formatCanonicalVal(params.memberName)}`,
    `membershipNumber=${formatCanonicalVal(params.membershipNumber)}`,
    `amountPaisa=${toAmountPaisa(params.amount)}`,
    `paymentDate=${formatPaymentDate(params.paymentDate)}`,
    `plotId=${formatCanonicalVal(params.plotId)}`,
    `plotNumber=${formatCanonicalVal(params.plotNumber)}`,
    `paymentRecordId=${formatCanonicalVal(params.paymentRecordId)}`,
    `issuedByAdminId=${formatCanonicalVal(params.issuedByAdminId)}`,
    `issuedByName=${formatCanonicalVal(params.issuedByName)}`,
    `issuedAt=${formatIssuedAt(params.issuedAt)}`,
  ].join('|');
}

export function computeReceiptHmac(canonicalString: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(canonicalString, 'utf8').digest('hex');
}

export function timingSafeCompare(hashA: string, hashB: string): boolean {
  if (!hashA || !hashB) return false;
  const bufA = Buffer.from(hashA, 'utf8');
  const bufB = Buffer.from(hashB, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

const lightweightReceiptSelect = {
  id: true,
  customerId: true,
  bookingId: true,
  paymentRecordId: true,
  depositoryBank: true,
  transactionRef: true,
  paymentDate: true,
  amount: true,
  paymentKind: true,
  status: true,
  verifiedByAdminId: true,
  verifiedAt: true,
  rejectionReason: true,
  slipNumber: true,
  slipNumberFormatVersion: true,
  verificationToken: true,
  qrTarget: true,
  securityHash: true,
  hashKeyVersion: true,
  uploadedAt: true,
  replacesReceiptId: true,
  issuedByNameSnapshot: true,
  cancelledAt: true,
  cancelledByAdminId: true,
  cancellationReason: true,
  cancellationReasonCode: true,
};

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
    let customerId: string;
    if (session.role === 'customer') {
      if (dto.customerId && dto.customerId !== session.customerId) {
        throw new ForbiddenException({
          error: 'IDOR_FORBIDDEN',
          message: 'You cannot submit receipts on behalf of another member account.',
        });
      }
      customerId = session.customerId;
    } else {
      customerId = dto.customerId || session.customerId || session.id;
    }

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
      const trimmedUrl = dto.receiptFileUrl.trim();
      if (trimmedUrl.startsWith('data:')) {
        // Parse data:<mime>;base64,<payload>
        const match = trimmedUrl.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$/s);
        if (!match) {
          throw new BadRequestException({
            error: 'INVALID_DATA_URL',
            message: 'Receipt upload rejected: INVALID_DATA_URL',
          });
        }

        const dataMime = (match[1] || '').toLowerCase().trim();
        const base64Payload = match[2].trim();

        if (!base64Payload) {
          throw new BadRequestException({
            error: 'INVALID_DATA_URL',
            message: 'Receipt upload rejected: INVALID_DATA_URL',
          });
        }

        // Cap decoded size before allocating huge buffers (reject over bucket maxSizeKb, 5MB = 5120 * 1024)
        const maxBytes = 5120 * 1024;
        let padding = 0;
        if (base64Payload.endsWith('==')) padding = 2;
        else if (base64Payload.endsWith('=')) padding = 1;
        const estimatedSize = Math.floor((base64Payload.length * 3) / 4) - padding;
        if (estimatedSize > maxBytes) {
          throw new BadRequestException({
            error: 'FILE_TOO_LARGE',
            message: 'Receipt upload rejected: FILE_TOO_LARGE',
          });
        }

        let buffer: Buffer;
        try {
          buffer = Buffer.from(base64Payload, 'base64');
          if (buffer.length === 0) {
            throw new Error('Empty buffer');
          }
        } catch {
          throw new BadRequestException({
            error: 'INVALID_DATA_URL',
            message: 'Receipt upload rejected: INVALID_DATA_URL',
          });
        }

        if (buffer.length > maxBytes) {
          throw new BadRequestException({
            error: 'FILE_TOO_LARGE',
            message: 'Receipt upload rejected: FILE_TOO_LARGE',
          });
        }

        // Synthetic object name for data URLs: use receiptFileName if present and has an allowed extension, else upload.jpg
        let syntheticName = 'upload.jpg';
        if (dto.receiptFileName && typeof dto.receiptFileName === 'string') {
          const dotIdx = dto.receiptFileName.lastIndexOf('.');
          if (dotIdx > 0) {
            const ext = dto.receiptFileName.substring(dotIdx + 1).toLowerCase();
            const EXT_TO_MIME: Record<string, string> = {
              jpg: 'image/jpeg',
              jpeg: 'image/jpeg',
              png: 'image/png',
              webp: 'image/webp',
              pdf: 'application/pdf',
            };
            if (EXT_TO_MIME[ext]) {
              syntheticName = dto.receiptFileName;
            }
          }
        }
        if (syntheticName === 'upload.jpg') {
          if (dataMime === 'image/png') syntheticName = 'upload.png';
          else if (dataMime === 'application/pdf') syntheticName = 'upload.pdf';
          else if (dataMime === 'image/webp') syntheticName = 'upload.webp';
        }

        const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
        const expectedMime = allowedMimes.includes(dataMime) ? dataMime : (dataMime || 'image/jpeg');

        const fileCheck = await this.storageService.verifyUploadedObject(
          'receipts',
          syntheticName,
          expectedMime,
          maxBytes,
          buffer,
        );
        if (!fileCheck.valid) {
          const isExecutable = fileCheck.error === 'DISALLOWED_EXECUTABLE_CONTENT';
          throw new BadRequestException({
            error: fileCheck.error || 'INVALID_UPLOADED_FILE',
            message: isExecutable
              ? 'This file was not accepted. A receipt must be a photo or a PDF. This file contains program content, so it cannot be uploaded.'
              : `Receipt upload rejected: ${fileCheck.error}`,
          });
        }
      } else {
        const rawKey = trimmedUrl.includes('receipts:')
          ? trimmedUrl.split('receipts:')[1]
          : trimmedUrl.split('/receipts/')[1] || trimmedUrl;
        const cleanKey = rawKey.split('?')[0].trim();
        const dotIdx = cleanKey.lastIndexOf('.');
        const ext = dotIdx > 0 ? cleanKey.substring(dotIdx + 1).toLowerCase() : 'jpg';
        const EXT_TO_MIME: Record<string, string> = {
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          png: 'image/png',
          webp: 'image/webp',
          pdf: 'application/pdf',
        };
        const expectedMime = EXT_TO_MIME[ext] || 'image/jpeg';
        const fileCheck = await this.storageService.verifyUploadedObject('receipts', cleanKey, expectedMime);
        if (!fileCheck.valid) {
          if (cleanKey) {
            await this.storageService.deleteUploadedObject('receipts', cleanKey).catch(() => {});
          }
          const isExecutable = fileCheck.error === 'DISALLOWED_EXECUTABLE_CONTENT';
          throw new BadRequestException({
            error: fileCheck.error || 'INVALID_UPLOADED_FILE',
            message: isExecutable
              ? 'This file was not accepted. A receipt must be a photo or a PDF. This file contains program content, so it cannot be uploaded.'
              : `Receipt upload rejected: ${fileCheck.error}`,
          });
        }
      }
    }

    // Verify plot ownership
    const booking = await this.prisma.withScopedSession(session, async (tx) => {
      return tx.booking.findFirst({
        where: {
          customerId: customer.id,
          plotId: dto.plotId,
          status: { in: ['active', 'completed'] },
        },
        include: {
          plot: { include: { block: true } },
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

    // Identify target payment record, next unpaid bill & plot balance
    let targetPaymentRecord: any = null;
    let unpaidOnNextBill = 0;
    let totalStillOwedOnPlot = 0;

    const dueStatuses = ['pending', 'overdue', 'partially_paid'];
    const installmentFeeTypes = ['plot_downpayment', 'plot_installment', 'plot_biannual', 'plot_possession'];

    let replacedReceipt: any = null;
    if (dto.replacesReceiptId) {
      replacedReceipt = await this.prisma.withScopedSession(session, async (tx) => {
        return tx.receiptSubmission.findUnique({
          where: { id: dto.replacesReceiptId },
        });
      });
      if (!replacedReceipt || replacedReceipt.customerId !== customer.id || replacedReceipt.bookingId !== booking.id) {
        throw new BadRequestException({
          error: 'INVALID_REPLACED_RECEIPT',
          message: 'The receipt to be replaced was not found on this member booking.',
        });
      }
      if (replacedReceipt.status !== 'rejected' && replacedReceipt.status !== 'cancelled') {
        throw new BadRequestException({
          error: 'RECEIPT_NOT_DECLINED',
          message: 'Only a declined or cancelled receipt can be re-uploaded.',
        });
      }
      const existingReplacement = await this.prisma.withScopedSession(session, async (tx) => {
        return tx.receiptSubmission.findFirst({
          where: {
            replacesReceiptId: dto.replacesReceiptId,
            status: { in: ['pending', 'verified'] },
          },
        });
      });
      if (existingReplacement) {
        throw new ConflictException({
          error: 'REPLACEMENT_ALREADY_EXISTS',
          message:
            existingReplacement.status === 'pending'
              ? 'A replacement receipt is already pending verification for this bill.'
              : 'This declined receipt has already been successfully replaced and verified.',
        });
      }
    }

    if (replacedReceipt) {
      if (replacedReceipt.paymentRecordId) {
        targetPaymentRecord = booking.payments.find((p) => p.id === replacedReceipt.paymentRecordId);
      }
      const billDue = targetPaymentRecord
        ? (Number(targetPaymentRecord.paidAmount) >= Number(targetPaymentRecord.amount)
            ? Number(replacedReceipt.amount)
            : Math.max(0, Number(targetPaymentRecord.amount) - Number(targetPaymentRecord.paidAmount)))
        : Number(replacedReceipt.amount);

      unpaidOnNextBill = billDue;

      const remainingUnpaidBills = booking.payments
        .filter((p) => installmentFeeTypes.includes(p.feeType) && (dueStatuses.includes(p.status) || Number(p.paidAmount || 0) < Number(p.amount)))
        .reduce((acc, p) => acc + Math.max(0, Number(p.amount) - Number(p.paidAmount)), 0);

      totalStillOwedOnPlot = Math.max(billDue, remainingUnpaidBills);
    } else if (dto.paymentType === 'installment') {
      const unpaidBills = booking.payments
        .filter((p) => installmentFeeTypes.includes(p.feeType) && (dueStatuses.includes(p.status) || Number(p.paidAmount || 0) < Number(p.amount)))
        .sort((a, b) => {
          if (a.feeType === 'plot_downpayment' && b.feeType !== 'plot_downpayment') return -1;
          if (b.feeType === 'plot_downpayment' && a.feeType !== 'plot_downpayment') return 1;
          if (a.dueDate && b.dueDate) {
            const cmp = new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
            if (cmp !== 0) return cmp;
          }
          return (a.installmentNumber || 0) - (b.installmentNumber || 0);
        });

      targetPaymentRecord = unpaidBills[0];

      if (!targetPaymentRecord) {
        throw new BadRequestException({
          error: 'NO_OUTSTANDING_INSTALLMENTS',
          message: 'No outstanding installments found for this plot.',
        });
      }

      unpaidOnNextBill = Math.max(0, Number(targetPaymentRecord.amount) - Number(targetPaymentRecord.paidAmount));
      totalStillOwedOnPlot = unpaidBills.reduce((acc, p) => acc + Math.max(0, Number(p.amount) - Number(p.paidAmount)), 0);

    } else if (dto.paymentType === 'one_time') {
      targetPaymentRecord = booking.payments.find(
        (p) => p.feeType === 'plot_one_time',
      );

      const plotPrice = Number(booking.plot?.price || targetPaymentRecord?.amount || 0);
      const paidOnPlot = Number(targetPaymentRecord?.paidAmount || 0);
      const unpaidOnPlot = Math.max(0, plotPrice - paidOnPlot);

      totalStillOwedOnPlot = unpaidOnPlot > 0 ? unpaidOnPlot : plotPrice;

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

    // Strict validation for payment kind and deposited amounts
    let previewData: any = null;
    let paymentKind = dto.paymentKind || 'regular';

    if (dto.paymentType === 'one_time' || booking.paymentType === 'one_time') {
      if (paymentKind === 'balloon') {
        throw new BadRequestException({
          error: 'BALLOON_NOT_ALLOWED',
          message: 'Balloon payments are not permitted on full-payment plots.',
        });
      }
      if (Math.abs(Number(dto.amount) - totalStillOwedOnPlot) > 0.01) {
        throw new BadRequestException({
          error: 'INVALID_AMOUNT',
          message: `Deposited amount must be the full amount still unpaid on this plot (PKR ${Math.round(totalStillOwedOnPlot).toLocaleString()}).`,
        });
      }
    } else if (dto.paymentType === 'installment') {
      if (paymentKind === 'regular') {
        if (Math.abs(Number(dto.amount) - unpaidOnNextBill) > 0.01) {
          throw new BadRequestException({
            error: 'INVALID_REGULAR_AMOUNT',
            message: `Regular payment must be exactly what is still unpaid on the next bill (PKR ${Math.round(unpaidOnNextBill).toLocaleString()}).`,
          });
        }
      } else if (paymentKind === 'balloon') {
        if (Number(dto.amount) < unpaidOnNextBill) {
          throw new BadRequestException({
            error: 'BALLOON_TOO_LOW',
            message: `A balloon payment cannot be smaller than the next bill (PKR ${Math.round(unpaidOnNextBill).toLocaleString()}).`,
          });
        }
        if (Number(dto.amount) > totalStillOwedOnPlot) {
          throw new BadRequestException({
            error: 'BALLOON_EXCEEDS_BALANCE',
            message: `A balloon payment cannot exceed the total balance owed on the plot (PKR ${Math.round(totalStillOwedOnPlot).toLocaleString()}).`,
          });
        }

        // Calculate balloon preview
        const pendingInst = booking.payments
          .filter((p) => installmentFeeTypes.includes(p.feeType) && (dueStatuses.includes(p.status) || Number(p.paidAmount || 0) < Number(p.amount)))
          .sort((a, b) => {
            if (a.feeType === 'plot_downpayment' && b.feeType !== 'plot_downpayment') return -1;
            if (b.feeType === 'plot_downpayment' && a.feeType !== 'plot_downpayment') return 1;
            if (a.feeType === 'plot_possession' && b.feeType !== 'plot_possession') return 1;
            if (b.feeType === 'plot_possession' && a.feeType !== 'plot_possession') return -1;
            const timeA = a.dueDate ? new Date(a.dueDate).getTime() : 0;
            const timeB = b.dueDate ? new Date(b.dueDate).getTime() : 0;
            if (timeA !== timeB) return timeA - timeB;
            return (a.installmentNumber || 0) - (b.installmentNumber || 0);
          })
          .map((p) => ({
            id: p.id,
            installmentNumber: p.installmentNumber,
            dueDate: p.dueDate ? new Date(p.dueDate) : null,
            amount: Number(p.amount),
            paidAmount: Number(p.paidAmount),
            status: p.status,
          }));

        const res = allocateBalloon(Number(dto.amount), pendingInst);
        if (res.error) {
          throw new BadRequestException({
            error: 'BALLOON_ENGINE_ERROR',
            message: res.error,
          });
        }
        previewData = res;
      }
    }

    // Check for existing pending receipt submission
    const pendingReceipt = await this.prisma.withScopedSession(session, async (tx) => {
      return tx.receiptSubmission.findFirst({
        where: {
          customerId: customer.id,
          bookingId: booking.id,
          status: 'pending',
          ...(dto.replacesReceiptId
            ? { replacesReceiptId: dto.replacesReceiptId }
            : paymentKind === 'balloon'
            ? {}
            : dto.paymentType === 'one_time' && targetPaymentRecord
            ? { paymentRecordId: targetPaymentRecord.id }
            : {}),
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
          transactionRef: (dto.transactionRef || (dto as any).transactionReference || '').trim(),
          paymentDate: isNaN(paymentDateParsed.getTime()) ? now : paymentDateParsed,
          amount: dto.amount,
          paymentKind: paymentKind,
          previewData: previewData,
          receiptFileUrl: (dto.receiptFileUrl.includes('receipts:')
            ? dto.receiptFileUrl.split('receipts:')[1]
            : dto.receiptFileUrl.split('/receipts/')[1] || dto.receiptFileUrl).split('?')[0].trim(),
          status: 'pending',
          uploadedAt: now,
          ...(dto.replacesReceiptId ? { replacesReceiptId: dto.replacesReceiptId } : {}),
        },
      });

      let biannualNumber = dto.installmentNumber || 1;
      if (targetPaymentRecord?.feeType === 'plot_biannual') {
        const biannualList = booking.payments
          .filter((p) => p.feeType === 'plot_biannual')
          .sort((a, b) => new Date(a.dueDate || 0).getTime() - new Date(b.dueDate || 0).getTime());
        const bIdx = biannualList.findIndex((p) => p.id === targetPaymentRecord.id);
        biannualNumber = bIdx >= 0 ? bIdx + 1 : (targetPaymentRecord.installmentNumber || 1);
      }

      const itemLabel = dto.paymentType === 'installment'
        ? (targetPaymentRecord?.feeType === 'plot_downpayment'
            ? 'Down payment'
            : targetPaymentRecord?.feeType === 'plot_possession'
            ? 'Possession'
            : targetPaymentRecord?.feeType === 'plot_biannual'
            ? `Bi-Annual #${biannualNumber}`
            : `Monthly #${targetPaymentRecord?.installmentNumber || dto.installmentNumber || 1}`)
        : 'Full Payment';

      await tx.auditEntry.create({
        data: {
          actorId: customer.id,
          actorName: customer.fullName,
          actorRole: 'customer',
          action: 'RECEIPT_SUBMITTED',
          entityType: 'receipt',
          entityId: receiptId,
          details: `Customer submitted deposit receipt for Plot ${booking.plot.plotNumber} (${itemLabel}) - PKR ${Number(dto.amount).toLocaleString()} via Depository Bank: ${bank}`,
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

    let resolvedInstNumber = dto.installmentNumber;
    if (dto.paymentType === 'installment' && targetPaymentRecord) {
      if (targetPaymentRecord.feeType === 'plot_biannual') {
        const biannualList = booking.payments
          .filter((p) => p.feeType === 'plot_biannual')
          .sort((a, b) => new Date(a.dueDate || 0).getTime() - new Date(b.dueDate || 0).getTime());
        const bIdx = biannualList.findIndex((p) => p.id === targetPaymentRecord.id);
        resolvedInstNumber = bIdx >= 0 ? bIdx + 1 : (targetPaymentRecord.installmentNumber || 1);
      } else {
        resolvedInstNumber = targetPaymentRecord.installmentNumber;
      }
    }

    return {
      ok: true,
      receipt: {
        ...result,
        customerName: customer.fullName,
        membershipNo: customer.membershipNo,
        plotNumber: booking.plot.plotNumber,
        blockName: booking.plot.block?.name || booking.plot.blockId,
        paymentType: dto.paymentType,
        feeType: targetPaymentRecord?.feeType || '',
        installmentNumber: resolvedInstNumber,
      },
    };
  }

  /**
   * 2. GET /receipts
   * Admin queue of receipts, block-scoped for sub-admins, enriched with strikes.
   */
  async getAdminReceipts(statusFilter: string | undefined, search: string | undefined, session: any, page: number = 1, pageSize: number = 10) {
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
    if (search) {
      where.OR = [
        { customer: { fullName: { contains: search, mode: 'insensitive' } } },
        { customer: { membershipNo: { contains: search, mode: 'insensitive' } } },
        { depositoryBank: { contains: search, mode: 'insensitive' } },
        { transactionRef: { contains: search, mode: 'insensitive' } },
        { slipNumber: { contains: search, mode: 'insensitive' } }
      ];
    }

    const parsedPageSize = Math.min(Number(pageSize) || 10, 10);
    const parsedPage = Math.max(1, Number(page) || 1);
    const skip = Math.max(0, (parsedPage - 1) * parsedPageSize);
    const take = parsedPageSize;

    let total = 0;
    const enriched = await this.prisma.withScopedSession(session, async (tx) => {
      const [totalCount, receipts] = await Promise.all([
        tx.receiptSubmission.count({ where }),
        tx.receiptSubmission.findMany({
          where,
          skip,
          take,
          select: {
            id: true,
            customerId: true,
            bookingId: true,
            paymentRecordId: true,
            depositoryBank: true,
            transactionRef: true,
            paymentDate: true,
            amount: true,
            paymentKind: true,
            status: true,
            verifiedByAdminId: true,
            verifiedAt: true,
            rejectionReason: true,
            slipNumber: true,
            slipNumberFormatVersion: true,
            verificationToken: true,
            qrTarget: true,
            securityHash: true,
            uploadedAt: true,
            replacesReceiptId: true,
            issuedByNameSnapshot: true,
            customer: {
              select: {
                id: true,
                fullName: true,
                membershipNo: true,
                phone: true,
                cnic: true,
                strikeCount: true,
                fatherOrHusbandName: true,
              },
            },
          },
          orderBy: { uploadedAt: 'desc' },
        }),
      ]);
      total = totalCount;

      const adminIds = [...new Set(receipts.map((r) => r.verifiedByAdminId).filter(Boolean))] as string[];
      let adminMap = new Map<string, { fullName: string; username: string }>();
      if (adminIds.length > 0) {
        const admins = await tx.adminUser.findMany({
          where: { id: { in: adminIds } },
          select: { id: true, fullName: true, username: true },
        });
        admins.forEach((a) => adminMap.set(a.id, a));
      }

      const bookingIds = [...new Set(receipts.map((r) => r.bookingId).filter(Boolean))];
      const bookings = await tx.booking.findMany({
        where: { id: { in: bookingIds } },
        include: { plot: { include: { block: true } } },
      });
      const bookingMap = new Map(bookings.map((b) => [b.id, b]));

      const paymentRecordIds = [...new Set(receipts.map((r) => r.paymentRecordId).filter(Boolean) as string[])];
      const paymentRecords = await tx.paymentRecord.findMany({
        where: { id: { in: paymentRecordIds } },
      });
      const paymentRecordMap = new Map(paymentRecords.map((p) => [p.id, p]));

      const receiptIds = receipts.map((r) => r.id);
      let photoMap = new Map<string, boolean>();
      if (receiptIds.length > 0) {
        const photos = await tx.$queryRaw<Array<{ id: string; hasPhoto: boolean }>>`
          SELECT id, (pg_column_size("receiptFileUrl") > 1) AS "hasPhoto"
          FROM "ReceiptSubmission"
          WHERE id IN (${Prisma.join(receiptIds)})
        `;
        photoMap = new Map(photos.map((p) => [p.id, Boolean(p.hasPhoto)]));
      }

      return receipts.map((r) => {
        const booking = bookingMap.get(r.bookingId);
        const paymentRecord = r.paymentRecordId ? paymentRecordMap.get(r.paymentRecordId) : null;
        const plotNumber = booking?.plot?.plotNumber || '';
        const blockName = booking?.plot?.block?.name || booking?.plot?.blockId || '';

        const verifiedOfficerName =
          r.issuedByNameSnapshot && r.issuedByNameSnapshot.trim()
            ? r.issuedByNameSnapshot.trim()
            : r.verifiedByAdminId
            ? (adminMap.get(r.verifiedByAdminId)?.fullName || adminMap.get(r.verifiedByAdminId)?.username || null)
            : null;

        return {
          ...r,
          verifiedByAdminName: verifiedOfficerName,
          hasPhoto: photoMap.get(r.id) ?? false,
          paymentDate: r.paymentDate ? (r.paymentDate instanceof Date ? r.paymentDate.toISOString().split('T')[0] : String(r.paymentDate).split('T')[0]) : null,
          customerName: r.customer?.fullName || '',
          membershipNo: r.customer?.membershipNo || '',
          customerPhone: r.customer?.phone,
          customerCnic: r.customer?.cnic,
          fatherOrHusbandName: r.customer?.fatherOrHusbandName || '',
          customerStrikeCount: r.customer?.strikeCount || 0,
          customerStrikeHistory: [],
          plotId: booking?.plot?.id,
          plotNumber,
          blockName,
          plotSize: booking?.plot?.size || '',
          plotCategory: booking?.plot?.category || '',
          feeType: paymentRecord?.feeType || '',
          paymentType: booking?.paymentType,
          installmentNumber: paymentRecord?.installmentNumber,
          verificationToken: r.verificationToken ?? null,
          qrTarget: r.qrTarget ?? null,
          slip: r.slipNumber ? {
            slipNumber: r.slipNumber,
            securityHash: r.securityHash,
            verificationToken: r.verificationToken || undefined,
            qrTarget: r.qrTarget || undefined,
            qrPayload: r.qrTarget || `/verify/${r.slipNumber}`,
            verifiedAt: r.verifiedAt ? (r.verifiedAt instanceof Date ? r.verifiedAt.toISOString().split('T')[0] : String(r.verifiedAt).split('T')[0]) : null,
            verifiedBy: verifiedOfficerName || r.verifiedByAdminId || 'Society Secretariat / Finance Officer',
          } : undefined,
        };
      });
    });

    return { ok: true, receipts: enriched, total, page: parsedPage, pageSize: parsedPageSize };
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

    const enriched = await this.prisma.withScopedSession(session, async (tx) => {
      const customer = await tx.customer.findUnique({
        where: { id: customerId },
        select: {
          id: true,
          fullName: true,
          membershipNo: true,
          phone: true,
          cnic: true,
          fatherOrHusbandName: true,
        },
      });

      const receipts = await tx.receiptSubmission.findMany({
        where: { customerId },
        select: lightweightReceiptSelect,
        orderBy: { uploadedAt: 'desc' },
      });

      const receiptIds = receipts.map((r) => r.id);
      let photoMap = new Map<string, { hasPhoto: boolean; receiptFileUrl: string | null }>();
      if (receiptIds.length > 0) {
        const photos = await tx.$queryRaw<Array<{ id: string; hasPhoto: boolean; receiptFileUrl: string | null }>>`
          SELECT id,
                 (pg_column_size("receiptFileUrl") > 1) AS "hasPhoto",
                 CASE
                   WHEN pg_column_size("receiptFileUrl") > 18 THEN "receiptFileUrl"
                   ELSE NULL
                 END AS "receiptFileUrl"
          FROM "ReceiptSubmission"
          WHERE id IN (${Prisma.join(receiptIds)})
        `;
        photoMap = new Map(
          photos.map((p) => {
            let key = p.receiptFileUrl;
            if (key && (key.startsWith('data:') || key.startsWith('blob:'))) {
              key = null;
            }
            return [p.id, { hasPhoto: Boolean(p.hasPhoto), receiptFileUrl: key }];
          })
        );
      }

      const adminIds = [...new Set(receipts.map((r) => r.verifiedByAdminId).filter(Boolean))] as string[];
      let adminMap = new Map<string, { fullName: string; username: string }>();
      if (adminIds.length > 0) {
        const admins = await tx.adminUser.findMany({
          where: { id: { in: adminIds } },
          select: { id: true, fullName: true, username: true },
        });
        admins.forEach((a) => adminMap.set(a.id, a));
      }

      const bookingIds = [...new Set(receipts.map((r) => r.bookingId).filter(Boolean))];
      const bookings = await tx.booking.findMany({
        where: { id: { in: bookingIds } },
        include: { plot: { include: { block: true } } },
      });
      const bookingMap = new Map(bookings.map((b) => [b.id, b]));

      const paymentRecordIds = [...new Set(receipts.map((r) => r.paymentRecordId).filter(Boolean) as string[])];
      const paymentRecords = await tx.paymentRecord.findMany({
        where: { id: { in: paymentRecordIds } },
      });
      const paymentRecordMap = new Map(paymentRecords.map((p) => [p.id, p]));

      const allocations = await tx.paymentAllocation.findMany({
        where: { receiptId: { in: receiptIds } },
        select: {
          receiptId: true,
          paymentRecordId: true,
          amountApplied: true,
          allocationType: true,
        },
      });
      const allocMap = new Map<string, any[]>();
      allocations.forEach((a) => {
        const list = allocMap.get(a.receiptId) || [];
        list.push({
          paymentRecordId: a.paymentRecordId,
          amountApplied: Number(a.amountApplied),
          allocationType: a.allocationType,
        });
        allocMap.set(a.receiptId, list);
      });

      return receipts.map((r) => {
        const booking = bookingMap.get(r.bookingId);
        const paymentRecord = r.paymentRecordId ? paymentRecordMap.get(r.paymentRecordId) : null;
        const plotNumber = booking?.plot?.plotNumber || '';
        const blockName = booking?.plot?.block?.name || booking?.plot?.blockId || '';
        const photoInfo = photoMap.get(r.id);

        const verifiedOfficerName =
          r.issuedByNameSnapshot && r.issuedByNameSnapshot.trim()
            ? r.issuedByNameSnapshot.trim()
            : r.verifiedByAdminId
            ? (adminMap.get(r.verifiedByAdminId)?.fullName || adminMap.get(r.verifiedByAdminId)?.username || null)
            : null;

        return {
          ...r,
          verifiedByAdminName: verifiedOfficerName,
          hasPhoto: photoInfo?.hasPhoto ?? false,
          receiptFileUrl: photoInfo?.receiptFileUrl ?? null,
          customerName: customer?.fullName || (r as any).customerName || '',
          membershipNo: customer?.membershipNo || (r as any).membershipNo || '',
          customerPhone: customer?.phone,
          customerCnic: customer?.cnic,
          fatherOrHusbandName: customer?.fatherOrHusbandName || '',
          paymentDate: r.paymentDate ? (r.paymentDate instanceof Date ? r.paymentDate.toISOString().split('T')[0] : String(r.paymentDate).split('T')[0]) : null,
          plotId: booking?.plot?.id,
          plotNumber,
          blockName,
          plotSize: booking?.plot?.size || '',
          plotCategory: booking?.plot?.category || '',
          feeType: paymentRecord?.feeType || '',
          paymentType: booking?.paymentType,
          installmentNumber: paymentRecord?.installmentNumber,
          verificationToken: r.verificationToken ?? null,
          qrTarget: r.qrTarget ?? null,
          allocations: allocMap.get(r.id) || [],
          slip: r.slipNumber ? {
            slipNumber: r.slipNumber,
            securityHash: r.securityHash,
            verificationToken: r.verificationToken || undefined,
            qrTarget: r.qrTarget || undefined,
            qrPayload: r.qrTarget || `/verify/${r.slipNumber}`,
            verifiedAt: r.verifiedAt ? (r.verifiedAt instanceof Date ? r.verifiedAt.toISOString().split('T')[0] : String(r.verifiedAt).split('T')[0]) : null,
            verifiedBy: verifiedOfficerName || r.verifiedByAdminId || 'Society Secretariat / Finance Officer',
          } : undefined,
        };
      });
    });

    return { ok: true, receipts: enriched };
  }

  async getUnreadCount(session: any, sinceStr?: string) {
    const customerId = session.sub || session.id || session.customerId;
    if (!customerId) return { ok: true, unreadCount: 0 };

    return this.prisma.withScopedSession(session, async (tx) => {
      let sinceDate: Date | null = null;
      if (sinceStr && !isNaN(new Date(sinceStr).getTime())) {
        sinceDate = new Date(sinceStr);
      }

      if (!sinceDate) {
        return { ok: true, unreadCount: 0 };
      }

      const count = await tx.receiptSubmission.count({
        where: {
          customerId,
          OR: [
            { uploadedAt: { gt: sinceDate } },
            { verifiedAt: { gt: sinceDate } },
            { cancelledAt: { gt: sinceDate } },
          ],
        },
      });

      return { ok: true, unreadCount: count };
    });
  }

  async getBalloonPreview(
    bookingId: string | undefined,
    plotId: string | undefined,
    amountStr: string,
    session: any,
  ) {
    const amount = Number(amountStr);
    if (isNaN(amount) || amount <= 0) {
      throw new BadRequestException({ error: 'INVALID_AMOUNT', message: 'Amount must be a positive number.' });
    }

    const cleanBookingId = bookingId ? String(bookingId).trim() : '';
    const cleanPlotId = plotId ? String(plotId).trim() : '';

    if (!cleanBookingId && !cleanPlotId) {
      throw new BadRequestException({
        error: 'PLOT_OR_BOOKING_REQUIRED',
        message: 'plotId or bookingId is required.',
      });
    }

    const customerId = session.sub || session.id || session.customerId;
    const booking = await this.prisma.withScopedSession(session, async (tx) => {
      if (cleanBookingId) {
        return tx.booking.findFirst({
          where: { id: cleanBookingId, status: { in: ['active', 'completed'] }, customerId },
          include: { payments: true },
        });
      } else {
        return tx.booking.findFirst({
          where: { plotId: cleanPlotId, status: { in: ['active', 'completed'] }, customerId },
          include: { payments: true },
        });
      }
    });

    if (!booking) throw new NotFoundException({ error: 'BOOKING_NOT_FOUND', message: 'Booking not found or not owned by you.' });
    if (booking.paymentType !== 'installment') {
      throw new BadRequestException({
        error: 'BALLOON_NOT_ALLOWED',
        message: 'Balloon payments are not permitted on full-payment plots.',
      });
    }

    const dueStatuses = ['pending', 'overdue', 'partially_paid'];
    const installmentFeeTypes = ['plot_downpayment', 'plot_installment', 'plot_biannual', 'plot_possession'];

    const pendingInst = booking.payments
      .filter((p) => installmentFeeTypes.includes(p.feeType) && (dueStatuses.includes(p.status) || Number(p.paidAmount || 0) < Number(p.amount)))
      .sort((a, b) => {
        if (a.feeType === 'plot_downpayment' && b.feeType !== 'plot_downpayment') return -1;
        if (b.feeType === 'plot_downpayment' && a.feeType !== 'plot_downpayment') return 1;
        if (a.feeType === 'plot_possession' && b.feeType !== 'plot_possession') return 1;
        if (b.feeType === 'plot_possession' && a.feeType !== 'plot_possession') return -1;
        const timeA = a.dueDate ? new Date(a.dueDate).getTime() : 0;
        const timeB = b.dueDate ? new Date(b.dueDate).getTime() : 0;
        if (timeA !== timeB) return timeA - timeB;
        return (a.installmentNumber || 0) - (b.installmentNumber || 0);
      })
      .map((p) => ({
        id: p.id,
        installmentNumber: p.installmentNumber,
        dueDate: p.dueDate ? new Date(p.dueDate) : null,
        amount: Number(p.amount),
        paidAmount: Number(p.paidAmount),
        status: p.status,
      }));

    const res = allocateBalloon(amount, pendingInst);
    if (res.error) {
      throw new BadRequestException({ error: 'BALLOON_ENGINE_ERROR', message: res.error });
    }

    const baseAllocations = Array.isArray(res.allocations) ? res.allocations : [];
    const enrichedAllocations = baseAllocations.map((a) => {
      const match = pendingInst.find((p) => p.id === a.paymentRecordId);
      return {
        ...a,
        installmentNumber: match?.installmentNumber ?? null,
      };
    });

    return {
      ok: true,
      allocations: enrichedAllocations,
      preview: {
        ...res,
        allocations: enrichedAllocations,
        remainingUnallocated: (res as any).remainingUnallocated ?? 0,
      },
    };
  }

  /**
   * GET /receipts/:id/file
   * Fetches the receipt file URL / signed URL on demand when admin clicks "View Bank Slip Image".
   */
  async getReceiptFile(id: string, session: any) {
    const isSuper = session.role === 'super_admin';
    const hasAuth = Boolean(session.permissions?.can_verify_receipts);

    if (!isSuper && !hasAuth && session.role !== 'customer') {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'You do not have Receipt Verification Authority to view slip files.',
      });
    }

    const receipt = await this.prisma.withScopedSession(session, async (tx) => {
      return tx.receiptSubmission.findUnique({
        where: { id },
        select: {
          id: true,
          receiptFileUrl: true,
          customerId: true,
        },
      });
    });

    if (!receipt) {
      throw new NotFoundException({
        error: 'RECEIPT_NOT_FOUND',
        message: 'Receipt submission not found.',
      });
    }

    if (session.role === 'customer' && receipt.customerId !== session.customerId) {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'Access denied to this receipt file.',
      });
    }

    let viewUrl = receipt.receiptFileUrl;
    if (!viewUrl) {
      throw new NotFoundException({
        error: 'FILE_NOT_FOUND',
        message: 'No file attached to this receipt.',
      });
    }

    // If viewUrl is a storage key or bucket reference, generate a signed view URL for the private bucket
    if (!viewUrl.startsWith('data:') && !viewUrl.startsWith('http://') && !viewUrl.startsWith('https://')) {
      const rawKey = viewUrl.includes('receipts:')
        ? viewUrl.split('receipts:')[1]
        : viewUrl.split('/receipts/')[1] || viewUrl;
      const cleanKey = rawKey.split('?')[0].trim();
      try {
        const signed = await this.storageService.generateSignedViewUrl({
          bucket: 'receipts',
          key: cleanKey,
        });
        if (signed?.viewUrl) {
          viewUrl = signed.viewUrl;
        }
      } catch {
        // Fallback to existing viewUrl
      }
    }

    return {
      ok: true,
      receiptFileUrl: viewUrl,
    };
  }

  /**
   * 4. POST /receipts/:id/verify
   * Verify and approve a submitted payment receipt.
   * Generates official two-part slip, reconciles PaymentRecord, and logs audit.
   */
  async verifyReceipt(receiptId: string, dto: VerifyReceiptDto, session: any, idempotencyKey?: string) {
    const isSuper = session.role === 'super_admin';
    const hasAuth = Boolean(session.permissions?.can_verify_receipts);

    if (!isSuper && !hasAuth) {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'You do not have Receipt Verification Authority to approve payment slips.',
      });
    }

    if (!idempotencyKey || typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
      throw new BadRequestException({
        error: 'MISSING_IDEMPOTENCY_KEY',
        message: 'Idempotency-Key header is required for receipt verification.',
      });
    }
    const cleanIdempotencyKey = idempotencyKey.trim();

    const hmacSecret = process.env.RECEIPT_HMAC_SECRET_V1?.trim();
    if (!hmacSecret) {
      throw new ServiceUnavailableException({
        error: 'RECEIPT_SIGNING_SECRET_MISSING',
        message: 'RECEIPT_HMAC_SECRET_V1 is not configured.',
      });
    }

    const rawOrigin = process.env.PUBLIC_RECEIPT_VERIFY_ORIGIN?.trim()?.replace(/\/$/, '');
    if (
      !rawOrigin ||
      rawOrigin.includes('localhost') ||
      rawOrigin.includes('127.0.0.1') ||
      rawOrigin.includes('192.168')
    ) {
      throw new ServiceUnavailableException({
        error: 'PUBLIC_VERIFY_ORIGIN_INVALID',
        message: 'PUBLIC_RECEIPT_VERIFY_ORIGIN is not configured or contains an invalid address.',
      });
    }
    const verifyOrigin = rawOrigin;

    // Deterministic payload hash for body mismatch detection (409)
    const requestPayload = {
      notes: dto.notes ?? null,
      confirmPreviewDrift: Boolean(dto.confirmPreviewDrift),
    };
    const requestHash = crypto.createHash('sha256').update(JSON.stringify(requestPayload)).digest('hex');

    const now = new Date();
    const year = now.getFullYear();
    const formatVersion = Number(process.env.RECEIPT_NUMBER_FORMAT_VERSION || '1');

    let activeSlipNumber: string | null = null;
    let activeReservationId: string | null = null;
    let broadcastPayload: any = null;
    let finalReturnResult: any = null;

    try {
      const result = await this.prisma.withScopedSession(session, async (tx) => {
        // ── 1. IDEMPOTENCY LOCK & DEDUPLICATION ─────────────────────────────
        // Ensure two approvals of one receipt cannot both succeed
        const priorApproval = await tx.receiptApprovalIdempotency.findFirst({
          where: {
            receiptId,
            status: 'SUCCEEDED',
            NOT: { key: cleanIdempotencyKey },
          },
        });
        if (priorApproval) {
          throw new ConflictException({
            error: 'ALREADY_PROCESSED',
            message: 'Receipt has already been approved by another officer action.',
          });
        }

        // Lock / Reserve the idempotency row before other locks
        let idempRow = await tx.receiptApprovalIdempotency.findUnique({
          where: { key: cleanIdempotencyKey },
        });

        if (idempRow) {
          await tx.$executeRawUnsafe(
            `SELECT 1 FROM "ReceiptApprovalIdempotency" WHERE "key" = $1 FOR UPDATE`,
            cleanIdempotencyKey
          );
          idempRow = await tx.receiptApprovalIdempotency.findUnique({
            where: { key: cleanIdempotencyKey },
          });
        } else {
          try {
            idempRow = await tx.receiptApprovalIdempotency.create({
              data: {
                key: cleanIdempotencyKey,
                receiptId,
                status: 'PROCESSING',
                requestHash,
              },
            });
            await tx.$executeRawUnsafe(
              `SELECT 1 FROM "ReceiptApprovalIdempotency" WHERE "key" = $1 FOR UPDATE`,
              cleanIdempotencyKey
            );
          } catch (createErr: any) {
            if (createErr.code === 'P2002' || createErr.message?.includes('unique') || createErr.message?.includes('duplicate key')) {
              await tx.$executeRawUnsafe(
                `SELECT 1 FROM "ReceiptApprovalIdempotency" WHERE "key" = $1 FOR UPDATE`,
                cleanIdempotencyKey
              );
              idempRow = await tx.receiptApprovalIdempotency.findUnique({
                where: { key: cleanIdempotencyKey },
              });
            } else {
              throw createErr;
            }
          }
        }

        if (!idempRow) {
          throw new BadRequestException({
            error: 'IDEMPOTENCY_INIT_FAILED',
            message: 'Could not initialize idempotency context.',
          });
        }

        // Verify key association and payload consistency
        if (idempRow.receiptId !== receiptId) {
          throw new ConflictException({
            error: 'IDEMPOTENCY_KEY_MISMATCH',
            message: 'This Idempotency-Key is already associated with another receipt.',
          });
        }

        if (idempRow.requestHash && idempRow.requestHash !== requestHash) {
          throw new ConflictException({
            error: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
            message: 'Same idempotency key cannot be used with different request payload.',
          });
        }

        // Same key + same body = stored result
        if (idempRow.status === 'SUCCEEDED' && idempRow.response) {
          return { isReplay: true, storedResponse: idempRow.response };
        }

        // Advance row to PROCESSING
        await tx.receiptApprovalIdempotency.update({
          where: { key: cleanIdempotencyKey },
          data: {
            status: 'PROCESSING',
            requestHash,
          },
        });

        // ── 2. PRE-FETCH TO PREPARE LOCKS ──────────────────────────────────
        const preReceipt = await tx.receiptSubmission.findUnique({
          where: { id: receiptId },
          select: {
            id: true,
            status: true,
            bookingId: true,
            paymentRecordId: true,
            paymentKind: true,
          },
        });

        if (!preReceipt) {
          throw new NotFoundException({
            error: 'RECEIPT_NOT_FOUND',
            message: 'Receipt submission not found.',
          });
        }

        if (preReceipt.status !== 'pending') {
          throw new ConflictException({
            error: 'ALREADY_PROCESSED',
            message: `Receipt has already been ${preReceipt.status}.`,
          });
        }

        // ── 3. STRICT LOCK ORDER: booking → payment(s) by id → receipt ──────
        // A. Booking lock
        if (preReceipt.bookingId) {
          await tx.$executeRawUnsafe(
            `SELECT 1 FROM "Booking" WHERE id = $1 FOR UPDATE`,
            preReceipt.bookingId
          );
        }

        // B. Payment(s) lock sorted by id ASC
        const paymentIdsToLock: string[] = [];
        if (preReceipt.paymentRecordId) {
          paymentIdsToLock.push(preReceipt.paymentRecordId);
        }
        if (preReceipt.paymentKind === 'balloon') {
          const balloonPayments = await tx.paymentRecord.findMany({
            where: {
              bookingId: preReceipt.bookingId,
              feeType: { in: ['plot_downpayment', 'plot_installment', 'plot_biannual', 'plot_possession'] },
              status: { in: ['pending', 'overdue', 'partially_paid'] },
            },
            select: { id: true },
          });
          for (const bp of balloonPayments) {
            paymentIdsToLock.push(bp.id);
          }
        }
        const uniqueSortedPaymentIds = Array.from(new Set(paymentIdsToLock)).sort();
        for (const pid of uniqueSortedPaymentIds) {
          await tx.$executeRawUnsafe(
            `SELECT 1 FROM "PaymentRecord" WHERE id = $1 FOR UPDATE`,
            pid
          );
        }

        // C. Receipt lock
        await tx.$executeRawUnsafe(
          `SELECT 1 FROM "ReceiptSubmission" WHERE id = $1 FOR UPDATE`,
          receiptId
        );

        // Re-check after receipt lock that it is still pending
        const receipt = await tx.receiptSubmission.findUnique({
          where: { id: receiptId },
          select: {
            id: true,
            status: true,
            paymentKind: true,
            bookingId: true,
            paymentRecordId: true,
            amount: true,
            paymentDate: true,
            transactionRef: true,
            customerId: true,
            previewData: true,
            replacesReceiptId: true,
            customer: {
              select: {
                id: true,
                fullName: true,
                membershipNo: true,
                phone: true,
                cnic: true,
                strikeCount: true,
                fatherOrHusbandName: true,
              },
            },
          },
        });

        if (!receipt || receipt.status !== 'pending') {
          throw new ConflictException({
            error: 'ALREADY_PROCESSED',
            message: `Receipt has already been ${receipt?.status || 'processed'}.`,
          });
        }

        // ── 4. RESERVE SLIP NUMBER (3 tries on unique collision, then 503) ──
        let slipNumber: string | null = null;
        let reservationId: string | null = null;

        for (let attempt = 1; attempt <= 3; attempt++) {
          const candidate = formatVersion === 2
            ? generateSlipNumber(year)
            : `PV-SLIP-${year}-${Math.floor(1000 + Math.random() * 9000)}`;

          // Check against pre-existing receipts in ReceiptSubmission
          const existingInReceipts = await tx.receiptSubmission.findUnique({
            where: { slipNumber: candidate },
            select: { id: true },
          });
          if (existingInReceipts) {
            if (attempt === 3) {
              throw new ServiceUnavailableException({
                error: 'SLIP_NUMBER_COLLISION_EXHAUSTED',
                message: 'Unable to reserve a unique slip number after 3 attempts. Please retry.',
              });
            }
            continue;
          }

          try {
            const resRow = await tx.receiptNumberReservation.create({
              data: {
                slipNumber: candidate,
                status: 'RESERVED',
                receiptId: receipt.id,
              },
            });
            slipNumber = candidate;
            reservationId = resRow.id;
            activeSlipNumber = candidate;
            activeReservationId = resRow.id;
            break;
          } catch (resErr: any) {
            if (resErr.code === 'P2002' || resErr.message?.includes('unique') || resErr.message?.includes('duplicate key')) {
              if (attempt === 3) {
                throw new ServiceUnavailableException({
                  error: 'SLIP_NUMBER_COLLISION_EXHAUSTED',
                  message: 'Unable to reserve a unique slip number after 3 attempts. Please retry.',
                });
              }
              continue; // retry only the reservation!
            }
            throw resErr;
          }
        }

        if (!slipNumber || !reservationId) {
          throw new ServiceUnavailableException({
            error: 'SLIP_NUMBER_RESERVATION_FAILED',
            message: 'Failed to reserve an official slip number.',
          });
        }

        const hexA = Math.random().toString(16).substring(2, 6).toUpperCase();
        const hexB = Math.random().toString(16).substring(2, 6).toUpperCase();
        const securityHash = `PV-SEC-${hexA}-${hexB}-${Date.now().toString().slice(-4)}`;

        const verificationToken = crypto.randomBytes(32).toString('base64url');
        const qrTarget = `${verifyOrigin}/verify/${verificationToken}`;

        const booking = await tx.booking.findUnique({
          where: { id: receipt.bookingId },
          include: { plot: { include: { block: true } } },
        });
        const plotId = booking?.plotId || booking?.plot?.id || null;
        const plotNumber = booking?.plot?.plotNumber || null;
        const blockName = booking?.plot?.block?.name || booking?.plot?.blockId || null;
        const plotSize = booking?.plot?.size || null;
        const plotCategory = booking?.plot?.category || null;

        const rawCnic = receipt.customer?.cnic || '';
        const cnicDigits = rawCnic.replace(/\D/g, '');
        const cnicLast4Snapshot = cnicDigits.length >= 4 ? cnicDigits.slice(-4) : (cnicDigits || null);
        const issuedByName = stripRoleFromOfficerName(session.fullName || session.username || null) || null;
        const issuedByAdminId = session.adminId || session.username || null;

        // ── 5. UPDATE RECEIPT, PAYMENT, ALLOCATION, AUDIT IN SAME TX ────────
        // Save initial snapshots and approval
        await tx.receiptSubmission.update({
          where: { id: receiptId },
          data: {
            status: 'verified',
            verifiedByAdminId: issuedByAdminId,
            verifiedAt: now,
            slipNumber,
            slipNumberFormatVersion: formatVersion,
            securityHash,
            verificationToken,
            qrTarget,
            memberNameSnapshot: receipt.customer?.fullName ?? null,
            membershipNumberSnapshot: receipt.customer?.membershipNo ?? null,
            cnicLast4Snapshot,
            plotNumberSnapshot: plotNumber,
            blockNameSnapshot: blockName,
            amountSnapshot: receipt.amount,
            paymentDateSnapshot: receipt.paymentDate,
            paymentRecordIdSnapshot: receipt.paymentRecordId ?? null,
            issuedByNameSnapshot: issuedByName,
            issuedAtSnapshot: now,
          },
        });

        // Read issuedAt from the database, not from new Date() in the fingerprint
        const dbRow = await tx.receiptSubmission.findUnique({
          where: { id: receiptId },
          select: { issuedAtSnapshot: true },
        });
        const dbIssuedAt = dbRow?.issuedAtSnapshot || now;

        // Build canonical string
        const canonicalString = buildReceiptCanonicalString({
          receiptId: receipt.id,
          slipNumber,
          memberId: receipt.customerId,
          memberName: receipt.customer?.fullName,
          membershipNumber: receipt.customer?.membershipNo,
          amount: receipt.amount,
          paymentDate: receipt.paymentDate,
          plotId,
          plotNumber,
          paymentRecordId: receipt.paymentRecordId,
          issuedByAdminId,
          issuedByName,
          issuedAt: dbIssuedAt,
        });

        // Compute HMAC
        const integrityHash = computeReceiptHmac(canonicalString, hmacSecret);
        const hashKeyVersion = 1;

        // Save integrityHash & hashKeyVersion
        const updatedReceipt = await tx.receiptSubmission.update({
          where: { id: receiptId },
          data: {
            integrityHash,
            hashKeyVersion,
          },
          select: lightweightReceiptSelect,
        });

        let finalAllocations: any = null;
        if (receipt.paymentKind === 'balloon') {
          const payments = await tx.paymentRecord.findMany({
            where: {
              bookingId: receipt.bookingId,
              feeType: { in: ['plot_downpayment', 'plot_installment', 'plot_biannual', 'plot_possession'] },
              status: { in: ['pending', 'overdue', 'partially_paid'] },
            },
          });
          const pendingInst = payments
            .sort((a, b) => {
              if (a.feeType === 'plot_downpayment' && b.feeType !== 'plot_downpayment') return -1;
              if (b.feeType === 'plot_downpayment' && a.feeType !== 'plot_downpayment') return 1;
              const timeA = a.dueDate ? new Date(a.dueDate).getTime() : 0;
              const timeB = b.dueDate ? new Date(b.dueDate).getTime() : 0;
              if (timeA !== timeB) return timeA - timeB;
              return (a.installmentNumber || 0) - (b.installmentNumber || 0);
            })
            .map((p) => ({
              id: p.id,
              installmentNumber: p.installmentNumber,
              dueDate: p.dueDate ? new Date(p.dueDate) : null,
              amount: Number(p.amount),
              paidAmount: Number(p.paidAmount),
              status: p.status,
            }));

          // Rule 8: If this is a re-upload of an already paid bill, only the extra above the bill is a balloon
          let balloonAmount = Number(receipt.amount);
          if (receipt.replacesReceiptId && receipt.paymentRecordId) {
            const currentPr = await tx.paymentRecord.findUnique({
              where: { id: receipt.paymentRecordId },
            });
            if (currentPr) {
              const existingPaid = Number(currentPr.paidAmount || 0);
              const needed = Math.max(0, Number(currentPr.amount) - existingPaid);
              if (needed === 0) {
                // Bill was already fully paid, only extra above bill applies to remaining balance
                const billAmount = Number(currentPr.amount);
                balloonAmount = Math.max(0, balloonAmount - billAmount);
              }
            }
          }

          if (balloonAmount > 0 && pendingInst.length > 0) {
            const engineResult = allocateBalloon(balloonAmount, pendingInst);
            if (engineResult.error) {
              throw new UnprocessableEntityException({ error: 'BALLOON_ERROR', message: engineResult.error });
            }

            const oldPreview = receipt.previewData || { allocations: [] };
            const sortAllocations = (a: any[]) =>
              [...a].map((alloc) => ({
                paymentRecordId: alloc.paymentRecordId,
                amountApplied: alloc.amountApplied,
                allocationType: alloc.allocationType,
              })).sort((x, y) => x.paymentRecordId.localeCompare(y.paymentRecordId));

            const oldSorted = JSON.stringify(sortAllocations((oldPreview as any).allocations || []));
            const newSorted = JSON.stringify(sortAllocations(engineResult.allocations));

            if (oldSorted !== newSorted && !dto.confirmPreviewDrift) {
              throw new ConflictException({
                error: 'PREVIEW_DRIFT',
                message: 'The customer schedule has changed since they submitted this receipt. Review the updated allocations and confirm.',
                newPreview: engineResult,
              });
            }
            finalAllocations = engineResult.allocations;
          } else {
            finalAllocations = [];
          }

          if (finalAllocations && finalAllocations.length > 0) {
            // Write the allocations in one batch
            const allocationsToInsert = finalAllocations.map((alloc: any) => ({
              id: crypto.randomUUID ? crypto.randomUUID() : `alloc-${receiptId}-${alloc.paymentRecordId}-${Date.now()}`,
              receiptId,
              paymentRecordId: alloc.paymentRecordId,
              amountApplied: alloc.amountApplied,
              allocationType: alloc.allocationType,
            }));
            await tx.paymentAllocation.createMany({
              data: allocationsToInsert,
            });

            // Update the affected bills
            const paymentMap = new Map(payments.map((p) => [p.id, p]));
            await Promise.all(
              finalAllocations.map(async (alloc: any) => {
                const currentPr = paymentMap.get(alloc.paymentRecordId);
                if (currentPr) {
                  const newPaidAmount = Number(currentPr.paidAmount) + alloc.amountApplied;
                  const newStatus = newPaidAmount >= Number(currentPr.amount) ? 'paid' : 'partially_paid';
                  return tx.paymentRecord.update({
                    where: { id: currentPr.id },
                    data: {
                      paidAmount: newPaidAmount,
                      status: newStatus,
                      paidDate: currentPr.paidDate ?? receipt.paymentDate,
                      transactionRef: currentPr.transactionRef ?? receipt.transactionRef,
                    },
                  });
                }
              }),
            );
          }
        }

        let paymentFeeType: string | null = null;
        if (receipt.paymentRecordId && receipt.paymentKind !== 'balloon') {
          const currentPr = await tx.paymentRecord.findUnique({
            where: { id: receipt.paymentRecordId },
          });
          if (currentPr) {
            paymentFeeType = currentPr.feeType;
            const existingPaid = Number(currentPr.paidAmount || 0);

            // Rule 8: Accepting a re-upload must not add the same bill twice.
            // Kokab's Bi-Annual #1 is already verified by MZN-09.
            // If already fully paid, do not add receipt.amount onto this bill!
            let amountToApply = Number(receipt.amount);
            if (receipt.replacesReceiptId) {
              const needed = Math.max(0, Number(currentPr.amount) - existingPaid);
              amountToApply = Math.min(amountToApply, needed);
            }

            const newPaidAmount = existingPaid + amountToApply;
            const isFullyPaid = newPaidAmount >= Number(currentPr.amount);
            const newStatus = isFullyPaid ? 'paid' : (newPaidAmount > 0 ? 'partially_paid' : currentPr.status);

            await tx.paymentRecord.update({
              where: { id: receipt.paymentRecordId },
              data: {
                status: newStatus,
                paidAmount: newPaidAmount,
                paidDate: currentPr.paidDate ?? receipt.paymentDate,
                transactionRef: currentPr.transactionRef ?? receipt.transactionRef,
              },
            });
          }
        }

        const plotPromoted = await maybeAllotIfFullyPaid(
          tx,
          receipt.bookingId,
          session.adminId || session.username || 'system',
        );

        let promotedPlotId: string | null = null;
        let promotedPlotNumber: string | null = null;
        let promotedBlockId: string | null = null;

        if (plotPromoted && booking?.plot) {
          promotedPlotId = booking.plot.id;
          promotedPlotNumber = booking.plot.plotNumber;
          promotedBlockId = booking.plot.blockId;

          const promoDetails =
            booking.paymentType === 'one_time'
              ? `Plot ${booking.plot.plotNumber} auto-promoted from booked to allotted — full payment cleared via receipt ${receiptId} (${slipNumber})`
              : `Plot ${booking.plot.plotNumber} auto-promoted from booked to allotted — all installment and possession payments cleared via receipt ${receiptId} (${slipNumber})`;

          await tx.auditEntry.create({
            data: {
              actorId: session.adminId || session.username,
              actorName: session.fullName || session.username,
              actorRole: session.role,
              action: 'PLOT_STATUS_CHANGED',
              entityType: 'plot',
              entityId: booking.plot.id,
              details: promoDetails,
              oldValue: { status: 'booked' },
              newValue: { status: 'allotted' },
            },
          });
        }

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

        if (receipt.replacesReceiptId) {
          await tx.auditEntry.create({
            data: {
              actorId: session.adminId || session.username,
              actorName: session.fullName || session.username,
              actorRole: session.role,
              action: 'RECEIPT_REPLACED',
              entityType: 'receipt',
              entityId: receipt.replacesReceiptId,
              details: `Declined receipt ${receipt.replacesReceiptId} successfully replaced by verified receipt ${receiptId} (${slipNumber})`,
              newValue: {
                replacementReceiptId: receiptId,
                slipNumber,
              },
            },
          });
        }

        // CONSUME RESERVATION
        await tx.receiptNumberReservation.update({
          where: { id: reservationId },
          data: { status: 'CONSUMED' },
        });

        const securityHashDisplay = integrityHash
          ? integrityHash.substring(0, 16)
          : securityHash;

        const responsePayload = {
          ok: true,
          plotPromoted: plotPromoted || false,
          promotedPlotId: promotedPlotId || null,
          promotedPlotNumber: promotedPlotNumber || null,
          receipt: {
            ...updatedReceipt,
            verifiedByAdminName: issuedByName || session.fullName || session.username,
            customerName: receipt.customer?.fullName,
            membershipNo: receipt.customer?.membershipNo,
            customerCnic: receipt.customer?.cnic,
            fatherOrHusbandName: receipt.customer?.fatherOrHusbandName,
            customer: receipt.customer,
            plotNumber,
            blockName,
            plotSize,
            plotCategory,
            feeType: paymentFeeType,
            verificationToken,
            qrTarget,
            hashKeyVersion,
            securityHashDisplay,
            slip: {
              slipNumber,
              securityHash,
              securityHashDisplay,
              hashKeyVersion,
              verificationToken,
              qrTarget,
              generatedAt: dbIssuedAt.toISOString(),
              qrPayload: qrTarget,
              verifiedBy: issuedByName || session.fullName || session.username,
              societyAuthorityStamp: `OFFICIAL SOCIETY VERIFICATION • REG NO 411 KPK • VERIFIED BY ${(session.fullName || session.username).toUpperCase()}`,
            },
          },
        };

        // MARK IDEMPOTENCY RECORD SUCCEEDED WITH STORED RESULT
        await tx.receiptApprovalIdempotency.update({
          where: { key: cleanIdempotencyKey },
          data: {
            status: 'SUCCEEDED',
            response: responsePayload,
          },
        });

        broadcastPayload = {
          receiptId: updatedReceipt.id,
          customerId: receipt.customerId,
          bookingId: receipt.bookingId,
          slipNumber,
          plotId,
          plotPromoted,
          promotedPlotId,
          promotedBlockId,
        };

        return { isReplay: false, response: responsePayload };
      });

      if (result.isReplay) {
        return result.storedResponse;
      }
      finalReturnResult = result.response;
    } catch (err: any) {
      // ON FAIL: receipt stays pending, payment unpaid, mark reservation ABANDONED
      if (activeSlipNumber) {
        try {
          await this.prisma.withScopedSession(session, async (failTx) => {
            await failTx.receiptNumberReservation.upsert({
              where: { slipNumber: activeSlipNumber! },
              update: { status: 'ABANDONED' },
              create: {
                slipNumber: activeSlipNumber!,
                receiptId,
                status: 'ABANDONED',
              },
            });
          });
        } catch {
          // ignore secondary update failure
        }
      }

      try {
        await this.prisma.withScopedSession(session, async (failTx) => {
          await failTx.receiptApprovalIdempotency.upsert({
            where: { key: cleanIdempotencyKey },
            update: { status: 'FAILED' },
            create: {
              key: cleanIdempotencyKey,
              receiptId,
              status: 'FAILED',
              requestHash,
            },
          });
        });
      } catch {
        // ignore secondary update failure
      }

      throw err;
    }

    // ── 6. BROADCAST ONLY AFTER COMMIT ────────────────────────────────────
    if (broadcastPayload) {
      await this.realtime.broadcast('receipts', 'RECEIPT_VERIFIED', {
        receiptId: broadcastPayload.receiptId,
        customerId: broadcastPayload.customerId,
        slipNumber: broadcastPayload.slipNumber,
      });

      await this.realtime.broadcast('plots', 'PAYMENT_RECORD_UPDATED', {
        customerId: broadcastPayload.customerId,
        bookingId: broadcastPayload.bookingId,
        plotId: broadcastPayload.plotId,
      });

      if (broadcastPayload.plotPromoted && broadcastPayload.promotedPlotId) {
        await this.realtime.broadcast(`block:${broadcastPayload.promotedBlockId}`, 'PLOT_STATUS_CHANGED', {
          plotId: broadcastPayload.promotedPlotId,
          status: 'allotted',
        });
        await this.realtime.broadcast('plots', 'PLOT_STATUS_CHANGED', {
          plotId: broadcastPayload.promotedPlotId,
          status: 'allotted',
        });
      }
    }

    return finalReturnResult;
  }

  /**
   * 4b. POST /receipts/:id/cancel
   * Cancel an already verified receipt and undo its payment.
   * Only super_admin may call.
   */
  async cancelReceipt(
    receiptId: string,
    dto: CancelReceiptDto,
    session: any,
    idempotencyKey?: string,
  ) {
    const hasAuth = Boolean(session.permissions?.can_verify_receipts);
    if (session.role !== 'super_admin' && !hasAuth) {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'Only authorized administrators can cancel a receipt.',
      });
    }

    if (
      !dto.reasonCode ||
      !['administrative_error', 'duplicate_receipt'].includes(dto.reasonCode)
    ) {
      throw new BadRequestException({
        error: 'INVALID_REASON_CODE',
        message: 'reasonCode must be either administrative_error or duplicate_receipt.',
      });
    }

    if (!dto.reason || typeof dto.reason !== 'string' || !dto.reason.trim()) {
      throw new BadRequestException({
        error: 'INVALID_REASON',
        message: 'Reason must be non-empty.',
      });
    }

    if (!idempotencyKey || typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
      throw new BadRequestException({
        error: 'MISSING_IDEMPOTENCY_KEY',
        message: 'Idempotency-Key header is required for receipt cancellation.',
      });
    }
    const cleanIdempotencyKey = idempotencyKey.trim();

    const requestPayload = {
      action: 'cancel',
      reasonCode: dto.reasonCode,
      reason: dto.reason.trim(),
    };
    const requestHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(requestPayload))
      .digest('hex');

    return await this.prisma.withScopedSession(session, async (tx) => {
      // ── 1. IDEMPOTENCY LOCK & DEDUPLICATION ──────────────────────────────
      let idempRow = await tx.receiptApprovalIdempotency.findUnique({
        where: { key: cleanIdempotencyKey },
      });

      if (idempRow) {
        await tx.$executeRawUnsafe(
          `SELECT 1 FROM "ReceiptApprovalIdempotency" WHERE "key" = $1 FOR UPDATE`,
          cleanIdempotencyKey,
        );
        idempRow = await tx.receiptApprovalIdempotency.findUnique({
          where: { key: cleanIdempotencyKey },
        });
      } else {
        try {
          idempRow = await tx.receiptApprovalIdempotency.create({
            data: {
              key: cleanIdempotencyKey,
              receiptId,
              status: 'PROCESSING',
              requestHash,
            },
          });
          await tx.$executeRawUnsafe(
            `SELECT 1 FROM "ReceiptApprovalIdempotency" WHERE "key" = $1 FOR UPDATE`,
            cleanIdempotencyKey,
          );
        } catch (createErr: any) {
          if (
            createErr.code === 'P2002' ||
            createErr.message?.includes('unique') ||
            createErr.message?.includes('duplicate key')
          ) {
            await tx.$executeRawUnsafe(
              `SELECT 1 FROM "ReceiptApprovalIdempotency" WHERE "key" = $1 FOR UPDATE`,
              cleanIdempotencyKey,
            );
            idempRow = await tx.receiptApprovalIdempotency.findUnique({
              where: { key: cleanIdempotencyKey },
            });
          } else {
            throw createErr;
          }
        }
      }

      if (!idempRow) {
        throw new BadRequestException({
          error: 'IDEMPOTENCY_INIT_FAILED',
          message: 'Could not initialize idempotency context.',
        });
      }

      if (idempRow.receiptId !== receiptId) {
        throw new ConflictException({
          error: 'IDEMPOTENCY_KEY_MISMATCH',
          message: 'This Idempotency-Key is already associated with another receipt.',
        });
      }

      if (idempRow.requestHash && idempRow.requestHash !== requestHash) {
        throw new ConflictException({
          error: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
          message: 'Same idempotency key cannot be used with different request payload.',
        });
      }

      if (idempRow.status === 'SUCCEEDED' && idempRow.response) {
        return idempRow.response;
      }

      await tx.receiptApprovalIdempotency.update({
        where: { key: cleanIdempotencyKey },
        data: {
          status: 'PROCESSING',
          requestHash,
        },
      });

      // ── 2. PRE-FETCH TO PREPARE LOCK ORDER ──────────────────────────────
      const preReceipt = await tx.receiptSubmission.findUnique({
        where: { id: receiptId },
        select: {
          id: true,
          bookingId: true,
          paymentRecordId: true,
          status: true,
        },
      });

      if (!preReceipt) {
        throw new NotFoundException({
          error: 'RECEIPT_NOT_FOUND',
          message: 'Receipt submission not found.',
        });
      }

      // ── 3. STRICT LOCK ORDER: Booking → Payment → Receipt ──────────────
      if (preReceipt.bookingId) {
        await tx.$executeRawUnsafe(
          `SELECT 1 FROM "Booking" WHERE id = $1 FOR UPDATE`,
          preReceipt.bookingId,
        );
      }

      if (preReceipt.paymentRecordId) {
        await tx.$executeRawUnsafe(
          `SELECT 1 FROM "PaymentRecord" WHERE id = $1 FOR UPDATE`,
          preReceipt.paymentRecordId,
        );
      }

      await tx.$executeRawUnsafe(
        `SELECT 1 FROM "ReceiptSubmission" WHERE id = $1 FOR UPDATE`,
        receiptId,
      );

      // Re-fetch receipt with full details
      const receipt = await tx.receiptSubmission.findUnique({
        where: { id: receiptId },
        include: {
          customer: true,
          allocations: true,
        },
      });

      if (!receipt) {
        throw new NotFoundException({
          error: 'RECEIPT_NOT_FOUND',
          message: 'Receipt submission not found.',
        });
      }

      // ── 4. 409 GUARDS ───────────────────────────────────────────────────
      // If status is pending, rejected, cancelled, replaced, or payment_reversed: return 409
      if (receipt.status !== 'verified') {
        throw new ConflictException({
          error: 'RECEIPT_NOT_VERIFIED',
          message: `Cannot cancel receipt with status '${receipt.status}'. Only verified receipts can be cancelled.`,
        });
      }

      // If paymentKind is balloon, or any PaymentAllocation exists: return 409
      if (receipt.paymentKind === 'balloon') {
        throw new ConflictException({
          error: 'BALLOON_RECEIPT_CANNOT_BE_CANCELLED',
          message: 'Balloon payment receipts cannot be cancelled.',
        });
      }

      if (receipt.allocations && receipt.allocations.length > 0) {
        throw new ConflictException({
          error: 'RECEIPT_HAS_ALLOCATIONS',
          message: 'Receipts with payment allocations cannot be cancelled.',
        });
      }

      if (!receipt.paymentRecordId) {
        throw new ConflictException({
          error: 'NO_PAYMENT_RECORD',
          message: 'Receipt has no associated payment record.',
        });
      }

      const payment = await tx.paymentRecord.findUnique({
        where: { id: receipt.paymentRecordId },
      });

      if (!payment) {
        throw new ConflictException({
          error: 'PAYMENT_RECORD_NOT_FOUND',
          message: 'Associated payment record not found.',
        });
      }

      // If paidAmount is not equal to this receipt's amount: return 409
      if (Number(payment.paidAmount) !== Number(receipt.amount)) {
        throw new ConflictException({
          error: 'PAID_AMOUNT_MISMATCH',
          message: 'Payment record paidAmount does not match receipt amount.',
        });
      }

      // If another verified receipt points at the same paymentRecordId: return 409
      const conflictingReceipt = await tx.receiptSubmission.findFirst({
        where: {
          paymentRecordId: receipt.paymentRecordId,
          status: 'verified',
          NOT: { id: receipt.id },
        },
      });

      if (conflictingReceipt) {
        throw new ConflictException({
          error: 'CONFLICTING_RECEIPT',
          message: 'Another verified receipt points to the same payment record.',
        });
      }

      // If paidDate does not match this receipt's payment date, or transactionRef does not match: return 409
      const paymentDateStr = payment.paidDate
        ? (payment.paidDate instanceof Date
            ? payment.paidDate.toISOString().split('T')[0]
            : String(payment.paidDate).split('T')[0])
        : null;
      const receiptDateStr = receipt.paymentDate
        ? (receipt.paymentDate instanceof Date
            ? receipt.paymentDate.toISOString().split('T')[0]
            : String(receipt.paymentDate).split('T')[0])
        : null;

      if (!paymentDateStr || paymentDateStr !== receiptDateStr) {
        throw new ConflictException({
          error: 'PAID_DATE_MISMATCH',
          message: 'Payment record paidDate does not match receipt paymentDate.',
        });
      }

      if (
        !payment.transactionRef ||
        payment.transactionRef.trim() !== receipt.transactionRef.trim()
      ) {
        throw new ConflictException({
          error: 'TRANSACTION_REF_MISMATCH',
          message: 'Payment record transactionRef does not match receipt transactionRef.',
        });
      }

      const now = new Date();

      // ── 5. EXECUTE CANCELLATION & PAYMENT ROLLBACK ───────────────────────
      // A. Receipt status becomes cancelled
      const updatedReceipt = await tx.receiptSubmission.update({
        where: { id: receiptId },
        data: {
          status: 'cancelled',
          cancelledAt: now,
          cancelledByAdminId: session.adminId || session.username,
          cancellationReasonCode: dto.reasonCode,
          cancellationReason: dto.reason.trim(),
        },
      });

      // B. Payment status becomes overdue when dueDate is before today, otherwise pending; or partially_paid if partial money remains
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const isOverdue = payment.dueDate ? new Date(payment.dueDate) < startOfToday : false;
      const remainingPaid = Math.max(0, Number(payment.paidAmount || 0) - Number(receipt.amount));
      const isFullyPaid = remainingPaid >= Number(payment.amount);
      const newPaymentStatus = isFullyPaid ? 'paid' : (remainingPaid > 0 ? 'partially_paid' : (isOverdue ? 'overdue' : 'pending'));

      const updatedPayment = await tx.paymentRecord.update({
        where: { id: payment.id },
        data: {
          status: newPaymentStatus,
          paidAmount: remainingPaid,
          paidDate: remainingPaid > 0 ? payment.paidDate : null,
          transactionRef: remainingPaid > 0 ? payment.transactionRef : null,
        },
      });

      // C. Change the plot from allotted to booked only when the latest PlotStatusHistory entry
      // is the automatic booked-to-allotted entry for this booking and the booking is no longer fully paid.
      let plotReverted = false;
      const booking = receipt.bookingId
        ? await tx.booking.findUnique({
            where: { id: receipt.bookingId },
            include: { plot: true },
          })
        : null;

      if (booking?.plot && booking.plot.status === PlotStatus.allotted) {
        let shouldRevert = false;

        if (booking.paymentType === 'installment') {
          // Installment booking: revert when any plot_downpayment, plot_installment, plot_biannual, or plot_possession row is missing, not paid, or paidAmount < amount.
          // Cancelling one installment receipt reverts the plot to booked.
          // Cancelling the possession receipt reverts the plot to booked.
          // If every one of those bills is still fully paid, do not revert.
          const installmentRecords = await tx.paymentRecord.findMany({
            where: {
              bookingId: booking.id,
              feeType: {
                in: ['plot_downpayment', 'plot_installment', 'plot_biannual', 'plot_possession'],
              },
            },
          });

          const hasPossession = installmentRecords.some((r) => r.feeType === 'plot_possession');
          const allPaid =
            installmentRecords.length > 0 &&
            hasPossession &&
            installmentRecords.every(
              (r) => r.status === 'paid' && Number(r.paidAmount) >= Number(r.amount),
            );

          if (!allPaid) {
            shouldRevert = true;
          }
        }

        if (shouldRevert) {
          const slip = receipt.slipNumber || receipt.id;
          await updatePlotStatus(tx, {
            plotId: booking.plot.id,
            fromStatus: PlotStatus.allotted,
            toStatus: PlotStatus.booked,
            changedBy: session.adminId || session.username || 'system',
            source: 'receipt_cancellation_undo_allot',
            reason: `Receipt ${slip} cancelled; booking ${booking.id} is no longer fully paid.`,
          });

          await tx.auditEntry.create({
            data: {
              actorId: session.adminId || session.username,
              actorName: session.fullName || session.username,
              actorRole: session.role,
              action: 'PLOT_STATUS_CHANGED',
              entityType: 'plot',
              entityId: booking.plot.id,
              details: `Plot ${booking.plot.plotNumber} reverted from 'allotted' to 'booked' due to cancellation of receipt ${receipt.slipNumber || receiptId}`,
              oldValue: { status: 'allotted' },
              newValue: { status: 'booked' },
            },
          });

          plotReverted = true;
        }
      }

      // D. AuditEntry in the same transaction
      await tx.auditEntry.create({
        data: {
          actorId: session.adminId || session.username,
          actorName: session.fullName || session.username,
          actorRole: session.role,
          action: 'RECEIPT_CANCELLED',
          entityType: 'receipt',
          entityId: receiptId,
          details: `Cancelled receipt ${receipt.slipNumber || receiptId} (${dto.reasonCode}): ${dto.reason.trim()}`,
          oldValue: { status: receipt.status },
          newValue: {
            status: 'cancelled',
            slipNumber: receipt.slipNumber,
            reasonCode: dto.reasonCode,
            reason: dto.reason.trim(),
            cancelledBy: session.adminId || session.username,
            cancelledAt: now.toISOString(),
          },
        },
      });

      // E. Persist response in Idempotency row
      const responsePayload = {
        ok: true,
        receipt: {
          id: updatedReceipt.id,
          slipNumber: updatedReceipt.slipNumber,
          status: updatedReceipt.status,
          cancelledAt: updatedReceipt.cancelledAt,
          cancellationReasonCode: updatedReceipt.cancellationReasonCode,
        },
        paymentRecord: {
          id: updatedPayment.id,
          status: updatedPayment.status,
          paidAmount: Number(updatedPayment.paidAmount),
          paidDate: updatedPayment.paidDate,
          transactionRef: updatedPayment.transactionRef,
        },
        plotReverted,
      };

      await tx.receiptApprovalIdempotency.update({
        where: { key: cleanIdempotencyKey },
        data: {
          status: 'SUCCEEDED',
          response: responsePayload,
        },
      });

      return responsePayload;
    });
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

    const receipt = await this.prisma.withScopedSession(session, async (tx) => {
      return tx.receiptSubmission.findUnique({
        where: { id: receiptId },
        select: {
          id: true,
          status: true,
          customerId: true,
          customer: {
            select: {
              id: true,
              fullName: true,
              membershipNo: true,
              strikeCount: true,
            },
          },
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
        select: lightweightReceiptSelect,
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
   * Uses privileged Prisma (DB owner / no RLS session) — same path as login.
   */
  async publicVerifySlip(slipNumber: string) {
    const cleanSlipNumber = (slipNumber || '').trim().replace(/[.,;:/\\]+$/, '');
    const verifiedData = await this.prisma.withScopedSession(
      { role: 'super_admin' },
      async (tx) => {
        const publicVerifyReceiptSelect = {
          id: true,
          customerId: true,
          bookingId: true,
          paymentRecordId: true,
          slipNumber: true,
          slipNumberFormatVersion: true,
          verificationToken: true,
          qrTarget: true,
          securityHash: true,
          integrityHash: true,
          hashKeyVersion: true,
          memberNameSnapshot: true,
          membershipNumberSnapshot: true,
          cnicLast4Snapshot: true,
          plotNumberSnapshot: true,
          blockNameSnapshot: true,
          amountSnapshot: true,
          paymentDateSnapshot: true,
          paymentRecordIdSnapshot: true,
          issuedByNameSnapshot: true,
          issuedAtSnapshot: true,
          verifiedByAdminId: true,
          amount: true,
          paymentDate: true,
          status: true,
          depositoryBank: true,
          transactionRef: true,
          verifiedAt: true,
          cancelledAt: true,
          customer: {
            select: { fullName: true, membershipNo: true, cnic: true, fatherOrHusbandName: true }
          },
        };

        let receipt = await tx.receiptSubmission.findUnique({
          where: { slipNumber: cleanSlipNumber },
          select: publicVerifyReceiptSelect,
        });

        if (!receipt && cleanSlipNumber.toUpperCase() !== cleanSlipNumber) {
          receipt = await tx.receiptSubmission.findUnique({
            where: { slipNumber: cleanSlipNumber.toUpperCase() },
            select: publicVerifyReceiptSelect,
          });
        }

        if (!receipt) {
          receipt = await tx.receiptSubmission.findFirst({
            where: { slipNumber: { equals: cleanSlipNumber, mode: 'insensitive' } },
            select: publicVerifyReceiptSelect,
          });
        }

        // Support lookup by verificationToken (for scanned QR targets)
        if (!receipt) {
          receipt = await tx.receiptSubmission.findUnique({
            where: { verificationToken: cleanSlipNumber },
            select: publicVerifyReceiptSelect,
          });
        }

        if (!receipt) {
          return null;
        }

        // Determine if one_time or installment
        const booking = receipt.bookingId
          ? await tx.booking.findUnique({
              where: { id: receipt.bookingId },
              select: {
                paymentType: true,
                plotId: true,
                plot: {
                  select: {
                    id: true,
                    plotNumber: true,
                    size: true,
                    category: true,
                    block: { select: { name: true } }
                  }
                }
              },
            })
          : null;
        const plotId = booking?.plotId || booking?.plot?.id || null;

        let installmentNumber: number | null = null;
        let isOneTime = booking?.paymentType === 'one_time';
        let feeType: string | null = null;

        if (receipt.paymentRecordId) {
          const pr = await tx.paymentRecord.findUnique({
            where: { id: receipt.paymentRecordId },
            select: { feeType: true, installmentNumber: true },
          });
          if (pr) {
            feeType = pr.feeType;
            if (pr.feeType === 'plot_one_time') isOneTime = true;
            if (pr.installmentNumber !== null && pr.installmentNumber !== undefined) {
              installmentNumber = pr.installmentNumber;
            }
          }
        }

        // Check cryptographic HMAC integrity if hashKeyVersion is set
        if (receipt.hashKeyVersion !== null && receipt.hashKeyVersion !== undefined) {
          const canonicalString = buildReceiptCanonicalString({
            receiptId: receipt.id,
            slipNumber: receipt.slipNumber,
            memberId: receipt.customerId,
            memberName: receipt.memberNameSnapshot,
            membershipNumber: receipt.membershipNumberSnapshot,
            amount: receipt.amountSnapshot,
            paymentDate: receipt.paymentDateSnapshot,
            plotId,
            plotNumber: receipt.plotNumberSnapshot,
            paymentRecordId: receipt.paymentRecordIdSnapshot,
            issuedByAdminId: receipt.verifiedByAdminId,
            issuedByName: receipt.issuedByNameSnapshot,
            issuedAt: receipt.issuedAtSnapshot,
          });

          let secretForVersion: string | undefined = undefined;
          if (receipt.hashKeyVersion === 1) {
            secretForVersion = process.env.RECEIPT_HMAC_SECRET_V1?.trim();
          }

          let isMatch = false;
          if (secretForVersion && receipt.integrityHash) {
            const computedHash = computeReceiptHmac(canonicalString, secretForVersion);
            isMatch = timingSafeCompare(receipt.integrityHash, computedHash);
          }

          if (!isMatch) {
            return {
              exists: true,
              status: 'integrity_mismatch',
              slipNumber: receipt.slipNumber || cleanSlipNumber,
            };
          }
        }

        // Post-HMAC status checks: cancelled, replaced, payment_reversed must not be treated as genuine
        if (receipt.status === 'cancelled') {
          return {
            exists: true,
            status: 'cancelled',
            slipNumber: receipt.slipNumber,
            cancelledAt: receipt.cancelledAt,
          };
        }

        if (receipt.status === 'replaced') {
          const replacement = await tx.receiptSubmission.findFirst({
            where: { replacesReceiptId: receipt.id },
            select: { slipNumber: true, verificationToken: true },
          });

          const rawOrigin = process.env.PUBLIC_RECEIPT_VERIFY_ORIGIN?.trim()?.replace(/\/$/, '');
          const verifyOrigin = (rawOrigin && !rawOrigin.includes('192.168.1.4')) ? rawOrigin : '';
          const replacedBySlipNumber = replacement?.slipNumber || null;
          const currentVerificationUrl = (replacedBySlipNumber && verifyOrigin)
            ? `${verifyOrigin}/verify/${replacedBySlipNumber}`
            : null;

          return {
            exists: true,
            status: 'replaced',
            slipNumber: receipt.slipNumber,
            replacedBySlipNumber,
            currentVerificationUrl,
          };
        }

        if (receipt.status === 'payment_reversed') {
          return {
            exists: true,
            status: receipt.status,
            slipNumber: receipt.slipNumber,
          };
        }

        const isSigned = receipt.hashKeyVersion !== null && receipt.hashKeyVersion !== undefined;

        if (isSigned) {
          const rawCnic = receipt.cnicLast4Snapshot || '';
          const cnicDigits = rawCnic.replace(/\D/g, '');
          const maskedCnic = cnicDigits.length >= 4
            ? `***********${cnicDigits.slice(-4)}`
            : (rawCnic ? `***********${rawCnic}` : null);

          const paymentDateVal = receipt.paymentDateSnapshot;
          const paymentDate = paymentDateVal
            ? (paymentDateVal instanceof Date ? paymentDateVal.toISOString().split('T')[0] : String(paymentDateVal).split('T')[0])
            : null;

          return {
            exists: true,
            status: receipt.status,
            slipNumber: receipt.slipNumber,
            memberDisplayName: receipt.memberNameSnapshot || null,
            cnic: maskedCnic,
            membershipNo: receipt.membershipNumberSnapshot ?? null,
            plotNumber: receipt.plotNumberSnapshot ?? null,
            amount: receipt.amountSnapshot,
            paymentDate,
            issuer: stripRoleFromOfficerName(receipt.issuedByNameSnapshot) || null,
            securityHashDisplay: receipt.integrityHash ? receipt.integrityHash.substring(0, 16) : null,
            hashKeyVersion: receipt.hashKeyVersion,
          };
        }

        const rawCnic = receipt.customer?.cnic || '';
        const cnicDigits = rawCnic.replace(/\D/g, '');
        const maskedCnic = cnicDigits.length >= 4
          ? `***********${cnicDigits.slice(-4)}`
          : (rawCnic ? '***********' : null);

        const memberDisplayName = receipt.customer?.fullName || 'Valued Member';
        const paymentDateVal = receipt.paymentDate;
        const paymentDate = paymentDateVal
          ? (paymentDateVal instanceof Date ? paymentDateVal.toISOString().split('T')[0] : String(paymentDateVal).split('T')[0])
          : null;

        let paymentDetails = isOneTime
          ? 'Payment: full upfront / one-time'
          : (installmentNumber !== null ? `Installment #${installmentNumber}` : 'Payment: installment');

        if (feeType === 'plot_biannual' || String(feeType || '').toLowerCase().includes('biannual')) {
          paymentDetails = `Bi-Annual #${installmentNumber ?? 1}`;
        }

        return {
          exists: true,
          status: receipt.status,
          slipNumber: receipt.slipNumber,
          memberDisplayName,
          customerName: memberDisplayName,
          cnic: maskedCnic,
          membershipNo: receipt.customer?.membershipNo || null,
          plotNumber: booking?.plot?.plotNumber || null,
          blockName: booking?.plot?.block?.name || null,
          plotSize: booking?.plot?.size || null,
          plotCategory: booking?.plot?.category || null,
          paymentType: booking?.paymentType || null,
          installmentLabel: paymentDetails,
          amount: receipt.amount,
          paymentDate,
          securityHash: receipt.securityHash || null,
          securityHashDisplay: receipt.securityHash || null,
          hashKeyVersion: null,
          verifiedAt: receipt.verifiedAt ? (receipt.verifiedAt instanceof Date ? receipt.verifiedAt.toISOString().split('T')[0] : String(receipt.verifiedAt).split('T')[0]) : null,
        };
      }
    );

    if (!verifiedData) {
      return { exists: false, status: 'not_found' };
    }

    return verifiedData;
  }
}
