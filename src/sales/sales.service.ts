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
      const conditions = [`a.action = 'PLOT_BOOKED'`];
      const params: any[] = [];
      let paramIdx = 1;

      if (assignedBlocks !== null) {
        if (assignedBlocks.length === 0) {
          conditions.push(`1 = 0`);
        } else {
          const blockIds = assignedBlocks.map(b => `'${b}'`).join(',');
          conditions.push(`p."blockId" IN (${blockIds})`);
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
        conditions.push(`a."actorId" = $${paramIdx++}`);
        params.push(filters.adminId);
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
          c."membershipNo" ILIKE $${paramIdx}
        )`);
        params.push(`%${filters.search}%`);
        paramIdx++;
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // 3. Pagination
      const page = Number(filters.page) || 1;
      const pageSize = Number(filters.pageSize) || 20;
      const offset = (page - 1) * pageSize;

      // 4. Queries
      const itemsQuery = `
        SELECT 
          a.id as "auditId",
          a.timestamp,
          a."actorId" as "sellerAdminId",
          a."actorName" as "sellerAdminName",
          a."actorRole" as "sellerAdminRole",
          p.id as "plotId",
          p."plotNumber",
          p."blockId",
          b.name as "blockName",
          p.category,
          p.size,
          (a."newValue"->>'salePrice')::numeric as price,
          c.id as "customerId",
          c."fullName" as "customerName",
          c."membershipNo",
          a."newValue"->>'paymentType' as "paymentType",
          a."newValue"->>'bookingId' as "bookingId"
        FROM "AuditEntry" a
        JOIN "Plot" p ON p.id = (a."newValue"->>'plotId')
        JOIN "Block" b ON b.id = p."blockId"
        JOIN "Customer" c ON c.id = (a."newValue"->>'customerId')
        ${whereClause}
        ORDER BY a.timestamp DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `;

      const kpisQuery = `
        SELECT 
          COUNT(*) as "totalPlotsSold",
          SUM((a."newValue"->>'salePrice')::numeric) as "totalRevenuePkr"
        FROM "AuditEntry" a
        JOIN "Plot" p ON p.id = (a."newValue"->>'plotId')
        JOIN "Customer" c ON c.id = (a."newValue"->>'customerId')
        ${whereClause}
      `;

      const categoryQuery = `
        SELECT 
          p.category, 
          COUNT(*) as count, 
          SUM((a."newValue"->>'salePrice')::numeric) as "revenuePkr"
        FROM "AuditEntry" a
        JOIN "Plot" p ON p.id = (a."newValue"->>'plotId')
        JOIN "Customer" c ON c.id = (a."newValue"->>'customerId')
        ${whereClause}
        GROUP BY p.category
      `;

      const topCloserQuery = `
        SELECT 
          a."actorId" as "id",
          a."actorName" as "name",
          COUNT(*) as count,
          SUM((a."newValue"->>'salePrice')::numeric) as "revenuePkr"
        FROM "AuditEntry" a
        JOIN "Plot" p ON p.id = (a."newValue"->>'plotId')
        JOIN "Customer" c ON c.id = (a."newValue"->>'customerId')
        ${whereClause}
        GROUP BY a."actorId", a."actorName"
        ORDER BY count DESC, "revenuePkr" DESC
        LIMIT 1
      `;

      const rawItems = await this.prisma.$queryRawUnsafe<any[]>(itemsQuery, ...params);
      const rawKpis = await this.prisma.$queryRawUnsafe<any[]>(kpisQuery, ...params);
      const rawCategory = await this.prisma.$queryRawUnsafe<any[]>(categoryQuery, ...params);
      const rawTopCloser = await this.prisma.$queryRawUnsafe<any[]>(topCloserQuery, ...params);
      const todayStats = await this.computeTodayStats(session, filters.adminId, assignedBlocks);

      // 5. Format Output
      const items = rawItems.map(row => {
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
          price: Number(row.price || 0),
          customerId: row.customerId,
          customerName: row.customerName,
          membershipNo: row.membershipNo || '—',
          paymentType: row.paymentType,
          sellerAdminId: row.sellerAdminId,
          sellerAdminName: row.sellerAdminName,
          sellerAdminRole: row.sellerAdminRole,
        };
      });

      const kpiRow = rawKpis[0] || {};
      const salesByCategory: Record<string, { count: number; revenuePkr: number }> = {};
      for (const row of rawCategory) {
        salesByCategory[row.category] = {
          count: Number(row.count),
          revenuePkr: Number(row.revenuePkr),
        };
      }

      let topCloser = null;
      if (rawTopCloser.length > 0) {
        topCloser = {
          id: rawTopCloser[0].id,
          name: rawTopCloser[0].name,
          count: Number(rawTopCloser[0].count),
          revenuePkr: Number(rawTopCloser[0].revenuePkr)
        };
      }

      return {
        ok: true,
        items,
        total: Number(kpiRow.totalPlotsSold || 0),
        page,
        pageSize,
        kpis: {
          totalPlotsSold: Number(kpiRow.totalPlotsSold || 0),
          totalRevenuePkr: Number(kpiRow.totalRevenuePkr || 0),
          todayPlotsSold: todayStats.todayPlotsSold,
          todayRevenuePkr: todayStats.todayRevenuePkr,
          topCloser,
          salesByCategory,
        }
      };

    } catch (error) {
      this.logger.error(`Sales History Error: ${error.message}`, error.stack);
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
    const conditions = [`a.action = 'PLOT_BOOKED'`, `a.timestamp >= CURRENT_DATE`];
    if (filterAdminId && filterAdminId !== 'all') {
      conditions.push(`a."actorId" = '${filterAdminId}'`);
    }
    if (assignedBlocks !== null) {
      if (assignedBlocks.length === 0) {
        conditions.push(`1 = 0`);
      } else {
        const blockIds = assignedBlocks.map(b => `'${b}'`).join(',');
        conditions.push(`p."blockId" IN (${blockIds})`);
      }
    }
    const whereClause = `WHERE ${conditions.join(' AND ')}`;
    const query = `
      SELECT 
        COUNT(*) as "todayPlotsSold",
        SUM((a."newValue"->>'salePrice')::numeric) as "todayRevenuePkr"
      FROM "AuditEntry" a
      JOIN "Plot" p ON p.id = (a."newValue"->>'plotId')
      ${whereClause}
    `;
    const res = await this.prisma.$queryRawUnsafe<any[]>(query);
    if (res.length > 0) {
      return {
        todayPlotsSold: Number(res[0].todayPlotsSold || 0),
        todayRevenuePkr: Number(res[0].todayRevenuePkr || 0)
      };
    }
    return { todayPlotsSold: 0, todayRevenuePkr: 0 };
  }
}
