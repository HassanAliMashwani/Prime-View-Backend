import { Injectable, OnModuleInit, OnModuleDestroy, ForbiddenException } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';

export interface ScopedSession {
  role: string;
  adminId?: string;
  customerId?: string;
  permissions?: Record<string, boolean>;
  source?: string;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  async withScopedSession<T>(
    session: ScopedSession,
    callback: (tx: Prisma.TransactionClient) => Promise<T>
  ): Promise<T> {
    // P2-03: Security Guard — reject role === 'system_sweep' unless source === 'sweep'
    if (session.role === 'system_sweep' && session.source !== 'sweep') {
      throw new ForbiddenException({
        error: 'UNAUTHORIZED_SYSTEM_ROLE',
        message: 'system_sweep role can only be invoked by internal daemon worker',
      });
    }

    return this.$transaction(
      async (tx) => {
        await tx.$executeRaw`
          SELECT set_config('app.current_role', ${session.role}, true),
                 set_config('app.current_admin_id', COALESCE(${session.adminId}, ''), true),
                 set_config('app.current_customer_id', COALESCE(${session.customerId}, ''), true),
                 set_config('app.can_create_customer', ${String(!!session.permissions?.can_create_customer)}, true),
                 set_config('app.can_book', ${String(!!session.permissions?.can_book)}, true),
                 set_config('app.can_reserve', ${String(!!session.permissions?.can_reserve)}, true),
                 set_config('app.can_view_sales_history', ${String(!!session.permissions?.can_view_sales_history)}, true),
                 set_config('app.current_permissions', ${JSON.stringify(session.permissions || {})}, true);
        `;
        return callback(tx);
      },
      {
        maxWait: 15000,
        timeout: 30000,
      }
    );
  }
}
