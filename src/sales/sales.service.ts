import { Injectable, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlotCategory } from '@prisma/client';

export interface SalesHistoryFilters {
  datePreset?: 'today' | 'yesterday' | 'last_7_days' | 'last_30_days' | 'this_month' | 'all';
  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string; // YYYY-MM-DD
  adminId?: string;
  blockId?: string;
  category?: 'all' | PlotCategory;
  paymentType?: 'all' | 'one_time' | 'installment';
  search?: string;
  page?: number;
  pageSize?: number;
}

@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);

  constructor(private prisma: PrismaService) {}

  async getSalesHistory(session: any, filters: SalesHistoryFilters) {
    try {
      // 1. Authorization + Scoping
      let assignedBlocks: string[] | null = null;

      if (session.role === 'super_admin') {
        assignedBlocks = null;
      } else {
        if (!session.permissions?.can_view_sales_history) {
          throw new ForbiddenException({
            error: 'FORBIDDEN_SALES_HISTORY_ACCESS',
            message: 'You do not have permission to view sales history.',
          });
        }
        assignedBlocks = session.assignedBlocks || [];
      }

      if (assignedBlocks !== null && filters.blockId) {
        if (!assignedBlocks.includes(filters.blockId)) {
          return this.emptyResult();
        }
      }

      // 2. Build SQL Conditions
      const conditions = [
        `a.action = 'PLOT_BOOKED'`,
        `p.id IS NOT NULL`,
        `(
          (a."newValue"->>'salePrice' ~ '^[0-9]+(\\.[0-9]+)?$' AND (a."newValue"->>'salePrice')::numeric > 0)
          OR (bk."installmentPlan"->>'totalPayment' ~ '^[0-9]+(\\.[0-9]+)?$' AND (bk."installmentPlan"->>'totalPayment')::numeric > 0)
          OR (p.price IS NOT NULL AND p.price > 0)
        )`
      ];
      const params: any[] = [];
      let paramIdx = 1;

      if (assignedBlocks !== null) {
        if (assignedBlocks.length === 0) {
          conditions.push(`1 = 0`);
        } else {
          const placeholders = assignedBlocks.map(() => `$${paramIdx++}`).join(',');
          conditions.push(`p."blockId" IN (${placeholders})`);
          params.push(...assignedBlocks);
        }
      }

      if (filters.blockId && filters.blockId !== 'all') {
        conditions.push(`p."blockId" = $${paramIdx++}`);
        params.push(filters.blockId);
      }

      if (filters.category && filters.category !== 'all') {
        conditions.push(`p.category = $${paramIdx++}::"PlotCategory"`);
        params.push(filters.category);
      }

      if (filters.paymentType && filters.paymentType !== 'all') {
        conditions.push(`a."newValue"->>'paymentType' = $${paramIdx++}`);
        params.push(filters.paymentType);
      }

      if (filters.adminId && filters.adminId !== 'all') {
        conditions.push(`(
          a."actorId" = $${paramIdx} 
          OR a."actorId" IN (SELECT u.username FROM "AdminUser" u WHERE u.id = $${paramIdx})
          OR a."actorId" IN (SELECT u.id FROM "AdminUser" u WHERE u.username = $${paramIdx})
        )`);
        params.push(filters.adminId);
        paramIdx++;
      }

      const now = new Date();
      if (filters.datePreset && filters.datePreset !== 'all') {
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (filters.datePreset === 'today') {
          conditions.push(`a.timestamp >= $${paramIdx++}`);
          params.push(startOfToday);
        } else if (filters.datePreset === 'yesterday') {
          const startOfYesterday = new Date(startOfToday);
          startOfYesterday.setDate(startOfYesterday.getDate() - 1);
          conditions.push(`a.timestamp >= $${paramIdx++} AND a.timestamp < $${paramIdx++}`);
          params.push(startOfYesterday, startOfToday);
        } else if (filters.datePreset === 'last_7_days') {
          const last7 = new Date(startOfToday);
          last7.setDate(last7.getDate() - 7);
          conditions.push(`a.timestamp >= $${paramIdx++}`);
          params.push(last7);
        } else if (filters.datePreset === 'last_30_days') {
          const last30 = new Date(startOfToday);
          last30.setDate(last30.getDate() - 30);
          conditions.push(`a.timestamp >= $${paramIdx++}`);
          params.push(last30);
        } else if (filters.datePreset === 'this_month') {
          const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
          conditions.push(`a.timestamp >= $${paramIdx++}`);
          params.push(thisMonth);
        }
      } else if (filters.dateFrom || filters.dateTo) {
        if (filters.dateFrom) {
          conditions.push(`a.timestamp >= $${paramIdx++}`);
          params.push(new Date(filters.dateFrom));
        }
        if (filters.dateTo) {
          const to = new Date(filters.dateTo);
          to.setDate(to.getDate() + 1);
          conditions.push(`a.timestamp < $${paramIdx++}`);
          params.push(to);
        }
      }

      if (filters.search) {
        conditions.push(`(
          p."plotNumber" ILIKE $${paramIdx} OR
          c."fullName" ILIKE $${paramIdx} OR
          c."membershipNo" ILIKE $${paramIdx} OR
          a."newValue"->>'plotNumber' ILIKE $${paramIdx} OR
          a."newValue"->>'customerName' ILIKE $${paramIdx}
        )`);
        params.push(`%${filters.search}%`);
        paramIdx++;
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // 3. Pagination
      const page = Math.max(1, Number(filters.page) || 1);
      const pageSize = Math.min(Number(filters.pageSize) || 10, 10);
      const offset = (page - 1) * pageSize;

      // 4. Single Combined Query
      const limitParamIdx = paramIdx++;
      const offsetParamIdx = paramIdx++;
      params.push(pageSize, offset);

      const itemsQuery = `
        SELECT 
          a.id as "auditId",
          a.timestamp,
          a."actorId" as "sellerAdminId",
          a."actorName" as "sellerAdminName",
          a."actorRole" as "sellerAdminRole",
          p.id as "plotId",
          COALESCE(p."plotNumber", a."newValue"->>'plotNumber') as "plotNumber",
          p."blockId",
          COALESCE(b.name, p."blockId", '—') as "blockName",
          p.category,
          p.size,
          CASE 
            WHEN a."newValue"->>'salePrice' ~ '^[0-9]+(\\.[0-9]+)?$' THEN (a."newValue"->>'salePrice')::numeric
            WHEN bk."installmentPlan"->>'totalPayment' ~ '^[0-9]+(\\.[0-9]+)?$' THEN (bk."installmentPlan"->>'totalPayment')::numeric
            WHEN p.price IS NOT NULL AND p.price > 0 THEN p.price
            ELSE 0
          END as price_num,
          COALESCE(c.id, a."newValue"->>'customerId') as "customerId",
          COALESCE(c."fullName", a."newValue"->>'customerName', '—') as "customerName",
          COALESCE(c."membershipNo", a."newValue"->>'membershipNo', '—') as "membershipNo",
          COALESCE(a."newValue"->>'paymentType', bk."paymentType"::text, 'installment') as "paymentType",
          COALESCE(a."newValue"->>'bookingId', bk.id, a."entityId") as "bookingId",
          COUNT(*) OVER() as "totalCount",
          SUM(
            CASE 
              WHEN a."newValue"->>'salePrice' ~ '^[0-9]+(\\.[0-9]+)?$' THEN (a."newValue"->>'salePrice')::numeric
              WHEN bk."installmentPlan"->>'totalPayment' ~ '^[0-9]+(\\.[0-9]+)?$' THEN (bk."installmentPlan"->>'totalPayment')::numeric
              WHEN p.price IS NOT NULL AND p.price > 0 THEN p.price
              ELSE 0
            END
          ) OVER() as "totalVolume"
        FROM "AuditEntry" a
        LEFT JOIN "Booking" bk ON bk.id = (a."newValue"->>'bookingId') OR bk.id = a."entityId"
        JOIN "Plot" p ON p.id = COALESCE(NULLIF(a."newValue"->>'plotId', ''), bk."plotId")
        LEFT JOIN "Block" b ON b.id = p."blockId"
        LEFT JOIN "Customer" c ON c.id = COALESCE(NULLIF(a."newValue"->>'customerId', ''), bk."customerId", p."currentOwnerId")
        ${whereClause}
        ORDER BY a.timestamp DESC
        LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}
      `;

      const rawItems = await this.prisma.$queryRawUnsafe<any[]>(itemsQuery, ...params);
      const total = rawItems.length > 0 ? Number(rawItems[0].totalCount || 0) : 0;
      const totalRevenuePkr = rawItems.length > 0 ? Number(rawItems[0].totalVolume || 0) : 0;

      // 5. Format Output
      const items = rawItems
        .filter(row => row.plotId && typeof Number(row.price_num) === 'number' && !isNaN(Number(row.price_num)) && Number(row.price_num) > 0)
        .map(row => {
          const date = new Date(row.timestamp);
          return {
            id: row.bookingId || row.auditId,
            auditId: row.auditId,
            timestamp: row.timestamp.toISOString(),
            dateStr: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
            timeStr: date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
            plotId: row.plotId,
            plotNumber: row.plotNumber,
            blockId: row.blockId,
            blockName: row.blockName,
            category: row.category,
            size: row.size,
            price: Number(row.price_num || 0),
            customerId: row.customerId,
            customerName: row.customerName,
            membershipNo: row.membershipNo || '—',
            paymentType: row.paymentType,
            sellerAdminId: row.sellerAdminId,
            sellerAdminName: row.sellerAdminName,
            sellerAdminRole: row.sellerAdminRole,
          };
        });

      const todayStats = await this.computeTodayStats(session, filters.adminId, assignedBlocks);

      return {
        ok: true,
        items,
        total,
        page,
        pageSize,
        kpis: {
          totalPlotsSold: total,
          totalRevenuePkr,
          todayPlotsSold: todayStats.todayPlotsSold,
          todayRevenuePkr: todayStats.todayRevenuePkr,
          topCloser: null,
          salesByCategory: {},
        }
      };

    } catch (error) {
      this.logger.error('Sales history query failed');
      if (error instanceof ForbiddenException) {
        throw error; // Let nest handle 403
      }
      return {
        ok: false,
        items: [],
        kpis: this.emptyResult().kpis,
        error: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while fetching sales history.',
      };
    }
  }

  private emptyResult(todayStats = { todayPlotsSold: 0, todayRevenuePkr: 0 }) {
    return {
      ok: true,
      items: [],
      kpis: {
        totalPlotsSold: 0,
        totalRevenuePkr: 0,
        todayPlotsSold: todayStats.todayPlotsSold,
        todayRevenuePkr: todayStats.todayRevenuePkr,
        topCloser: null,
        salesByCategory: {},
      }
    };
  }

  private async computeTodayStats(session: any, filterAdminId: string | undefined, assignedBlocks: string[] | null) {
    const conditions = [
      `a.action = 'PLOT_BOOKED'`,
      `a.timestamp >= CURRENT_DATE`,
      `p.id IS NOT NULL`,
      `(
        (a."newValue"->>'salePrice' ~ '^[0-9]+(\\.[0-9]+)?$' AND (a."newValue"->>'salePrice')::numeric > 0)
        OR (bk."installmentPlan"->>'totalPayment' ~ '^[0-9]+(\\.[0-9]+)?$' AND (bk."installmentPlan"->>'totalPayment')::numeric > 0)
        OR (p.price IS NOT NULL AND p.price > 0)
      )`
    ];
    const params: any[] = [];
    let paramIdx = 1;

    if (filterAdminId && filterAdminId !== 'all') {
      conditions.push(`(
        a."actorId" = $${paramIdx} 
        OR a."actorId" IN (SELECT u.username FROM "AdminUser" u WHERE u.id = $${paramIdx})
        OR a."actorId" IN (SELECT u.id FROM "AdminUser" u WHERE u.username = $${paramIdx})
      )`);
      params.push(filterAdminId);
      paramIdx++;
    }
    if (assignedBlocks !== null) {
      if (assignedBlocks.length === 0) {
        conditions.push(`1 = 0`);
      } else {
        const placeholders = assignedBlocks.map(() => `$${paramIdx++}`).join(',');
        conditions.push(`p."blockId" IN (${placeholders})`);
        params.push(...assignedBlocks);
      }
    }
    const whereClause = `WHERE ${conditions.join(' AND ')}`;
    const query = `
      SELECT 
        COUNT(*) as "todayPlotsSold",
        COALESCE(SUM(
          CASE 
            WHEN a."newValue"->>'salePrice' ~ '^[0-9]+(\\.[0-9]+)?$' THEN (a."newValue"->>'salePrice')::numeric
            WHEN bk."installmentPlan"->>'totalPayment' ~ '^[0-9]+(\\.[0-9]+)?$' THEN (bk."installmentPlan"->>'totalPayment')::numeric
            WHEN p.price IS NOT NULL AND p.price > 0 THEN p.price
            ELSE 0
          END
        ), 0) as "todayRevenuePkr"
      FROM "AuditEntry" a
      LEFT JOIN "Booking" bk ON bk.id = (a."newValue"->>'bookingId') OR bk.id = a."entityId"
      JOIN "Plot" p ON p.id = COALESCE(NULLIF(a."newValue"->>'plotId', ''), bk."plotId")
      ${whereClause}
    `;
    const res = await this.prisma.$queryRawUnsafe<any[]>(query, ...params);
    if (res.length > 0) {
      return {
        todayPlotsSold: Number(res[0].todayPlotsSold || 0),
        todayRevenuePkr: Number(res[0].todayRevenuePkr || 0)
      };
    }
    return { todayPlotsSold: 0, todayRevenuePkr: 0 };
  }
}
