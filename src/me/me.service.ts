import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MeService {
  constructor(private prisma: PrismaService) {}

  async getPlots(customerId: string) {
    return this.prisma.withScopedSession({ role: 'customer', customerId }, async (tx) => {
      const plots = await tx.plot.findMany({
        where: { currentOwnerId: customerId },
        include: {
          reservations: {
            where: { customerId },
          },
          bookings: {
            where: { customerId },
            include: {
              payments: true,
            },
          },
        },
      });

      return plots.map((p: any) => {
        const b = p.bookings && p.bookings.length > 0 ? p.bookings[0] : null;
        const billsCount = b && b.payments
          ? b.payments.filter((pay: any) =>
              ['plot_installment', 'plot_one_time', 'plot_downpayment', 'plot_biannual', 'plot_possession'].includes(pay.feeType),
            ).length
          : 0;
        const hasPaymentPlan = billsCount > 0;

        return {
          ...p,
          hasPaymentPlan,
          billsCount,
          bookings: (p.bookings || []).map((booking: any) => ({
            ...booking,
            hasPaymentPlan,
            billsCount,
          })),
        };
      });
    });
  }

  async getPayments(customerId: string) {
    return this.prisma.withScopedSession({ role: 'customer', customerId }, async (tx) => {
      return tx.paymentRecord.findMany({
        where: {
          booking: { customerId },
        },
        orderBy: {
          dueDate: 'desc',
        },
      });
    });
  }

  async getDocuments(customerId: string) {
    return this.prisma.withScopedSession({ role: 'customer', customerId }, async (tx) => {
      return tx.societyDocument.findMany({
        where: { customerId },
        orderBy: { uploadedAt: 'desc' },
      });
    });
  }
}
