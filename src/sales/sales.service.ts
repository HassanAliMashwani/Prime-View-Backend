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
}

@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);

  constructor(private prisma: PrismaService) {}

  async getSalesHistory(session: any, filters: SalesHistoryFilters) {
    try {
      // 1. Authorization + Scoping
      let assignedBlocks: string[] | null = null; // null means all blocks

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

      // If user passed a blockId that is not in their assigned blocks, they get empty
      if (assignedBlocks !== null && filters.blockId) {
        if (!assignedBlocks.includes(filters.blockId)) {
          return this.emptyResult();
        }
      }

      // 2. Base AuditEntry Date Filter
      const dateFilter = this.getDateFilter(filters);
      
      const auditWhere: any = {
        action: 'PLOT_BOOKED',
      };
      
      if (dateFilter) {
        auditWhere.timestamp = dateFilter;
      }

      if (filters.adminId && filters.adminId !== 'all') {
        auditWhere.actorId = filters.adminId;
      }

      const auditEntries = await this.prisma.withScopedSession(session, tx => tx.auditEntry.findMany({
        where: auditWhere,
        orderBy: { timestamp: 'desc' }
      }));

      if (auditEntries.length === 0) {
        // Compute "today" stats if empty (today stats still respect assignedBlocks and adminId)
        return this.emptyResult(await this.computeTodayStats(session, filters.adminId, assignedBlocks));
      }

      // 3. Batch Fetch Related Data
      const plotIds = [...new Set(auditEntries.map(e => (e.newValue as any)?.plotId).filter(Boolean))];
      const customerIds = [...new Set(auditEntries.map(e => (e.newValue as any)?.customerId).filter(Boolean))];

      const [plots, customers] = await this.prisma.withScopedSession(session, tx => Promise.all([
        tx.plot.findMany({
          where: { id: { in: plotIds } },
          include: { block: true }
        }),
        tx.customer.findMany({
          where: { id: { in: customerIds } }
        })
      ]));

      const plotMap = new Map(plots.map(p => [p.id, p]));
      const customerMap = new Map(customers.map(c => [c.id, c]));

      // 4. Assemble and Apply In-Memory Filters
      let items = [];

      for (const entry of auditEntries) {
        const payload = entry.newValue as any || {};
        const plotId = payload.plotId;
        const customerId = payload.customerId;

        const plot = plotMap.get(plotId);
        const customer = customerMap.get(customerId);

        if (!plot || !customer) continue;

        // Block Scoping
        if (assignedBlocks !== null && !assignedBlocks.includes(plot.blockId)) {
          continue;
        }

        // Additional Filters
        if (filters.blockId && filters.blockId !== 'all' && plot.blockId !== filters.blockId) {
          continue;
        }
        if (filters.category && filters.category !== 'all' && plot.category !== filters.category) {
          continue;
        }
        if (filters.paymentType && filters.paymentType !== 'all' && payload.paymentType !== filters.paymentType) {
          continue;
        }
        
        if (filters.search) {
          const s = filters.search.toLowerCase();
          const matchPlot = plot.plotNumber.toLowerCase().includes(s);
          const matchCustomer = customer.fullName.toLowerCase().includes(s);
          const matchMembership = (customer.membershipNo || '').toLowerCase().includes(s);
          if (!matchPlot && !matchCustomer && !matchMembership) {
            continue;
          }
        }

        const date = new Date(entry.timestamp);
        
        items.push({
          id: payload.bookingId || entry.id, // Fallback to auditId if bookingId missing
          auditId: entry.id,
          timestamp: entry.timestamp.toISOString(),
          dateStr: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          timeStr: date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
          plotId: plot.id,
          plotNumber: plot.plotNumber,
          blockId: plot.blockId,
          blockName: plot.block.name,
          category: plot.category,
          size: plot.size,
          price: Number(payload.salePrice || 0),
          customerId: customer.id,
          customerName: customer.fullName,
          membershipNo: customer.membershipNo || '—',
          paymentType: payload.paymentType,
          sellerAdminId: entry.actorId,
          sellerAdminName: entry.actorName,
          sellerAdminRole: entry.actorRole,
        });
      }

      // Sort just in case order was disrupted, though already desc from DB
      items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      // 5. KPIs Computation
      let totalPlotsSold = 0;
      let totalRevenuePkr = 0;
      const salesByCategory: Record<string, { count: number; revenuePkr: number }> = {};
      const adminStats: Record<string, { name: string; count: number; revenuePkr: number }> = {};

      for (const item of items) {
        totalPlotsSold++;
        totalRevenuePkr += item.price;

        if (!salesByCategory[item.category]) {
          salesByCategory[item.category] = { count: 0, revenuePkr: 0 };
        }
        salesByCategory[item.category].count++;
        salesByCategory[item.category].revenuePkr += item.price;

        if (!adminStats[item.sellerAdminId]) {
          adminStats[item.sellerAdminId] = { name: item.sellerAdminName, count: 0, revenuePkr: 0 };
        }
        adminStats[item.sellerAdminId].count++;
        adminStats[item.sellerAdminId].revenuePkr += item.price;
      }

      let topCloser = null;
      for (const [adminId, stats] of Object.entries(adminStats)) {
        if (!topCloser) {
          topCloser = { id: adminId, ...stats };
        } else if (stats.count > topCloser.count || (stats.count === topCloser.count && stats.revenuePkr > topCloser.revenuePkr)) {
          topCloser = { id: adminId, ...stats };
        }
      }

      const todayStats = await this.computeTodayStats(session, filters.adminId, assignedBlocks);

      return {
        ok: true,
        items,
        kpis: {
          totalPlotsSold,
          totalRevenuePkr,
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

  private getDateFilter(filters: SalesHistoryFilters) {
    const now = new Date();
    
    if (filters.datePreset && filters.datePreset !== 'all') {
      const preset = filters.datePreset;
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      
      if (preset === 'today') {
        return { gte: startOfToday };
      } else if (preset === 'yesterday') {
        const startOfYesterday = new Date(startOfToday);
        startOfYesterday.setDate(startOfYesterday.getDate() - 1);
        return { gte: startOfYesterday, lt: startOfToday };
      } else if (preset === 'last_7_days') {
        const last7 = new Date(startOfToday);
        last7.setDate(last7.getDate() - 7);
        return { gte: last7 };
      } else if (preset === 'last_30_days') {
        const last30 = new Date(startOfToday);
        last30.setDate(last30.getDate() - 30);
        return { gte: last30 };
      } else if (preset === 'this_month') {
        const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        return { gte: thisMonth };
      }
    } else if (filters.dateFrom || filters.dateTo) {
      const range: any = {};
      if (filters.dateFrom) {
        range.gte = new Date(filters.dateFrom);
      }
      if (filters.dateTo) {
        const to = new Date(filters.dateTo);
        to.setDate(to.getDate() + 1); // include the end date fully
        range.lt = to;
      }
      if (Object.keys(range).length > 0) return range;
    }
    
    return undefined;
  }

  private async computeTodayStats(session: any, filterAdminId: string | undefined, assignedBlocks: string[] | null) {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    const auditWhere: any = {
      action: 'PLOT_BOOKED',
      timestamp: { gte: startOfToday }
    };

    if (filterAdminId && filterAdminId !== 'all') {
      auditWhere.actorId = filterAdminId;
    }

    const todayEntries = await this.prisma.withScopedSession(session, tx => tx.auditEntry.findMany({
      where: auditWhere
    }));

    if (todayEntries.length === 0) {
      return { todayPlotsSold: 0, todayRevenuePkr: 0 };
    }

    let todayPlotsSold = 0;
    let todayRevenuePkr = 0;

    if (assignedBlocks === null) {
      // Super admin, all count
      for (const e of todayEntries) {
        todayPlotsSold++;
        todayRevenuePkr += Number((e.newValue as any)?.salePrice || 0);
      }
    } else {
      // Sub admin, must filter by assigned blocks (requires joining plot)
      const plotIds = [...new Set(todayEntries.map(e => (e.newValue as any)?.plotId).filter(Boolean))];
      if (plotIds.length === 0) return { todayPlotsSold: 0, todayRevenuePkr: 0 };

      const plots = await this.prisma.withScopedSession(session, tx => tx.plot.findMany({
        where: { id: { in: plotIds } },
        select: { id: true, blockId: true }
      }));
      const plotMap = new Map(plots.map(p => [p.id, p.blockId]));

      for (const e of todayEntries) {
        const plotId = (e.newValue as any)?.plotId;
        const blockId = plotMap.get(plotId);
        if (blockId && assignedBlocks.includes(blockId)) {
          todayPlotsSold++;
          todayRevenuePkr += Number((e.newValue as any)?.salePrice || 0);
        }
      }
    }

    return { todayPlotsSold, todayRevenuePkr };
  }
}
