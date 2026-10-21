import { Injectable, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlotCategory, PlotStatus } from '@prisma/client';

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

export interface SalesHistoryItem {
  id: string;
  auditId: string;
  timestamp: string;
  dateStr: string;
  timeStr: string;
  plotId: string;
  plotNumber: string;
  blockId: string;
  blockName: string;
  category: PlotCategory;
  size: string;
  price: number;
  customerId: string;
  customerName: string;
  membershipNo: string;
  paymentType: 'one_time' | 'installment';
  sellerAdminId: string;
  sellerAdminName: string;
  sellerAdminRole: 'super_admin' | 'sub_admin';
  registrationStatusLabel: 'Needs registration' | 'Portal issued';
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
        const hasSalesBox = Boolean(
          session.permissions?.can_view_sales_reports &&
          session.permissions?.can_view_sales_history
        );
        if (!hasSalesBox) {
          throw new ForbiddenException({
            error: 'FORBIDDEN_SALES_HISTORY_ACCESS',
            message: 'You do not have permission to view sales history.',
          });
        }
        assignedBlocks = session.assignedBlocks || [];
      }

      if (assignedBlocks !== null && filters.blockId && filters.blockId !== 'all') {
        if (!assignedBlocks.includes(filters.blockId)) {
          return this.emptyResult();
        }
      }

      return await this.prisma.withScopedSession(session, async (tx) => {
        // 2 & 3. Fetch admin users to resolve officer names and query live Booking rows in parallel
        const [adminUsers, rawBookings] = await Promise.all([
          tx.adminUser.findMany({
            select: {
              id: true,
              username: true,
              fullName: true,
              role: true,
            },
          }),
          tx.booking.findMany({
            where: {
              plot: {
                status: { in: [PlotStatus.booked, PlotStatus.allotted] },
              },
              customer: {
                id: { not: '' },
              },
            },
            select: {
              id: true,
              bookingDate: true,
              plotId: true,
              paymentType: true,
              installmentPlan: true,
              createdByAdminId: true,
              plot: {
                select: {
                  id: true,
                  plotNumber: true,
                  blockId: true,
                  category: true,
                  size: true,
                  price: true,
                  block: {
                    select: {
                      name: true,
                    },
                  },
                },
              },
              customer: {
                select: {
                  id: true,
                  fullName: true,
                  membershipNo: true,
                  registrationStatus: true,
                },
              },
            },
            orderBy: {
              bookingDate: 'desc',
            },
          }),
        ]);

        const adminMap = new Map<string, { id: string; username: string; fullName: string; role: 'super_admin' | 'sub_admin' }>();
        for (const u of adminUsers) {
          const role: 'super_admin' | 'sub_admin' = u.role === 'super_admin' ? 'super_admin' : 'sub_admin';
          const info = { id: u.id, username: u.username, fullName: u.fullName, role };
          adminMap.set(u.id, info);
          adminMap.set(u.username, info);
        }

        // 4. One row per plot — deduplicate by plotId taking the latest booking
        const seenPlots = new Set<string>();
        const uniquePlotBookings: typeof rawBookings = [];

        for (const b of rawBookings) {
          if (b.plot && b.customer && !seenPlots.has(b.plotId)) {
            seenPlots.add(b.plotId);
            uniquePlotBookings.push(b);
          }
        }

        // 5. Transform each booking to standard sales item
        const allItems: SalesHistoryItem[] = uniquePlotBookings.map((b) => {
          const bookingDate = new Date(b.bookingDate);
          const planTotal = (b.installmentPlan as any)?.totalPayment ? Number((b.installmentPlan as any).totalPayment) : 0;
          const price = (planTotal && !isNaN(planTotal) && planTotal > 0) ? planTotal : Number(b.plot.price || 0);

          const officer = adminMap.get(b.createdByAdminId) || {
            id: b.createdByAdminId,
            username: b.createdByAdminId,
            fullName: b.createdByAdminId,
            role: 'sub_admin' as const,
          };

          const isRegistered = b.customer.registrationStatus === 'complete';
          const registrationStatusLabel: 'Needs registration' | 'Portal issued' = isRegistered
            ? 'Portal issued'
            : 'Needs registration';

          return {
            id: b.id,
            auditId: b.id,
            timestamp: bookingDate.toISOString(),
            dateStr: bookingDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
            timeStr: bookingDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
            plotId: b.plot.id,
            plotNumber: b.plot.plotNumber,
            blockId: b.plot.blockId,
            blockName: b.plot.block?.name || b.plot.blockId || '—',
            category: b.plot.category,
            size: b.plot.size,
            price,
            customerId: b.customer.id,
            customerName: b.customer.fullName,
            membershipNo: b.customer.membershipNo || '—',
            paymentType: b.paymentType === 'one_time' ? 'one_time' : 'installment',
            sellerAdminId: officer.id,
            sellerAdminName: officer.fullName || officer.username || b.createdByAdminId,
            sellerAdminRole: officer.role,
            registrationStatusLabel,
          };
        });

        // 6. Apply filters to these live rows
        // Scoping: assignedBlocks
        let filtered = allItems;
        if (assignedBlocks !== null) {
          filtered = filtered.filter((item) => assignedBlocks!.includes(item.blockId));
        }

        // Block filter
        if (filters.blockId && filters.blockId !== 'all') {
          filtered = filtered.filter((item) => item.blockId === filters.blockId);
        }

        // Category filter
        if (filters.category && filters.category !== 'all') {
          filtered = filtered.filter((item) => item.category === filters.category);
        }

        // Payment type filter
        if (filters.paymentType && filters.paymentType !== 'all') {
          filtered = filtered.filter((item) => item.paymentType === filters.paymentType);
        }

        // Officer filter: matches admin id or username
        if (filters.adminId && filters.adminId !== 'all') {
          const targetAdmin = adminMap.get(filters.adminId);
          const targetIds = new Set<string>([filters.adminId]);
          if (targetAdmin) {
            targetIds.add(targetAdmin.id);
            targetIds.add(targetAdmin.username);
          }
          filtered = filtered.filter((item) => targetIds.has(item.sellerAdminId));
        }

        // Search filter: plot number, customer name, membership number
        if (filters.search && filters.search.trim()) {
          const s = filters.search.trim().toLowerCase();
          filtered = filtered.filter(
            (item) =>
              item.plotNumber.toLowerCase().includes(s) ||
              item.customerName.toLowerCase().includes(s) ||
              (item.membershipNo && item.membershipNo.toLowerCase().includes(s))
          );
        }

        // Date filter using booking date
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startOfTomorrow = new Date(startOfToday);
        startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

        if (filters.datePreset && filters.datePreset !== 'all') {
          if (filters.datePreset === 'today') {
            filtered = filtered.filter((item) => {
              const d = new Date(item.timestamp);
              return d >= startOfToday && d < startOfTomorrow;
            });
          } else if (filters.datePreset === 'yesterday') {
            const startOfYesterday = new Date(startOfToday);
            startOfYesterday.setDate(startOfYesterday.getDate() - 1);
            filtered = filtered.filter((item) => {
              const d = new Date(item.timestamp);
              return d >= startOfYesterday && d < startOfToday;
            });
          } else if (filters.datePreset === 'last_7_days') {
            const last7 = new Date(startOfToday);
            last7.setDate(last7.getDate() - 7);
            filtered = filtered.filter((item) => new Date(item.timestamp) >= last7);
          } else if (filters.datePreset === 'last_30_days') {
            const last30 = new Date(startOfToday);
            last30.setDate(last30.getDate() - 30);
            filtered = filtered.filter((item) => new Date(item.timestamp) >= last30);
          } else if (filters.datePreset === 'this_month') {
            const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            filtered = filtered.filter((item) => new Date(item.timestamp) >= thisMonth);
          }
        } else if (filters.dateFrom || filters.dateTo) {
          if (filters.dateFrom) {
            const from = new Date(filters.dateFrom);
            filtered = filtered.filter((item) => new Date(item.timestamp) >= from);
          }
          if (filters.dateTo) {
            const to = new Date(filters.dateTo);
            to.setDate(to.getDate() + 1);
            filtered = filtered.filter((item) => new Date(item.timestamp) < to);
          }
        }

        // 7. Calculate Counts & KPIs on the filtered live rows
        // - Filtered Units Sold = the number of rows.
        // - Sold Today = the rows whose booking date is today.
        // - Total Sales Volume = the sum of the row prices.
        // - Top Sales Closer = officer who booked the most of these rows (tie breaker: higher price sum). If empty: null.
        const totalPlotsSold = filtered.length;
        let totalRevenuePkr = 0;
        let todayPlotsSold = 0;
        let todayRevenuePkr = 0;

        const officerStatsMap = new Map<string, { id: string; name: string; count: number; revenuePkr: number }>();
        const salesByCategory: Record<string, { count: number; revenuePkr: number }> = {};

        for (const row of filtered) {
          totalRevenuePkr += row.price;

          const rowDate = new Date(row.timestamp);
          if (rowDate >= startOfToday && rowDate < startOfTomorrow) {
            todayPlotsSold += 1;
            todayRevenuePkr += row.price;
          }

          // Category stats
          const cat = row.category;
          if (!salesByCategory[cat]) {
            salesByCategory[cat] = { count: 0, revenuePkr: 0 };
          }
          salesByCategory[cat].count += 1;
          salesByCategory[cat].revenuePkr += row.price;

          // Officer stats
          const officerKey = row.sellerAdminId || row.sellerAdminName;
          const curr = officerStatsMap.get(officerKey) || {
            id: row.sellerAdminId,
            name: row.sellerAdminName,
            count: 0,
            revenuePkr: 0,
          };
          curr.count += 1;
          curr.revenuePkr += row.price;
          officerStatsMap.set(officerKey, curr);
        }

        let topCloser: { id: string; name: string; count: number; revenuePkr: number } | null = null;
        for (const stat of officerStatsMap.values()) {
          if (!topCloser) {
            topCloser = stat;
          } else if (stat.count > topCloser.count) {
            topCloser = stat;
          } else if (stat.count === topCloser.count && stat.revenuePkr > topCloser.revenuePkr) {
            topCloser = stat;
          }
        }

        // 8. Pagination
        // Supports larger pageSize (e.g. 10000) for full Print ledger load while keeping default 10
        const page = Math.max(1, Number(filters.page) || 1);
        const pageSize = Math.min(Math.max(1, Number(filters.pageSize) || 10), 10000);
        const offset = (page - 1) * pageSize;
        const pagedItems = filtered.slice(offset, offset + pageSize);

        return {
          ok: true,
          items: pagedItems,
          total: totalPlotsSold,
          page,
          pageSize,
          kpis: {
            totalPlotsSold,
            totalRevenuePkr,
            todayPlotsSold,
            todayRevenuePkr,
            topCloser,
            salesByCategory,
          },
        };
      });
    } catch (error) {
      this.logger.error('Sales history query failed', error instanceof Error ? error.stack : error);
      if (error instanceof ForbiddenException) {
        throw error;
      }
      return {
        ok: false,
        items: [],
        kpis: this.emptyResult().kpis,
        error: 'INTERNAL_SERVER_ERROR',
        message: 'Sales history failed to load.',
      };
    }
  }

  private emptyResult() {
    return {
      ok: true,
      items: [],
      total: 0,
      page: 1,
      pageSize: 10,
      kpis: {
        totalPlotsSold: 0,
        totalRevenuePkr: 0,
        todayPlotsSold: 0,
        todayRevenuePkr: 0,
        topCloser: null,
        salesByCategory: {},
      },
    };
  }
}
