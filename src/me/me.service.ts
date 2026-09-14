import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MeService {
  constructor(private prisma: PrismaService) {}

  async getPlots(customerId: string) {
    return this.prisma.withScopedSession({ role: 'customer', customerId }, async (tx) => {
      return tx.plot.findMany({
        where: { currentOwnerId: customerId },
        include: {
          reservations: {
            where: { customerId }
          },
          bookings: {
            where: { customerId },
            include: {
              payments: true,
            }
          }
        }
      });
    });
  }

  async getPayments(customerId: string) {
    return this.prisma.withScopedSession({ role: 'customer', customerId }, async (tx) => {
      return tx.paymentRecord.findMany({
        where: {
          booking: { customerId }
        },
        orderBy: {
          dueDate: 'desc'
        }
      });
    });
  }
}
