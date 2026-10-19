import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MeService {
  constructor(private prisma: PrismaService) {}

  async getPlots(customerId: string) {
    return this.prisma.withScopedSession({ role: 'customer', customerId }, async (tx) => {
      const plots = await tx.plot.findMany({
        where: {
          OR: [
            { currentOwnerId: customerId },
            { bookings: { some: { customerId } } },
          ],
        },
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
        const allPayments = (p.bookings || []).flatMap((booking: any) => booking.payments || []);
        const billsCount = allPayments.filter((pay: any) =>
          ['plot_installment', 'plot_one_time', 'plot_downpayment', 'plot_biannual', 'plot_possession'].includes(pay.feeType),
        ).length;
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
