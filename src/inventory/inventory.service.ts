import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService, ScopedSession } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

export interface InventoryBlockStats {
  blockId: string;
  blockName: string;
  booked: number;
  allotted: number;
  reserved: number;
  available: number;
  disputedTotal: number;
}

export interface InventoryTotals {
  available: number;
  reserved: number;
  booked: number;
  allotted: number;
  disputedTotal: number;
  total: number;
}

export interface MonthlyHistoryPoint {
  month: string;
  label: string;
  year: number;
  available: number;
  reserved: number;
  booked: number;
}

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats(session: ScopedSession, from?: string, to?: string, blockId?: string, query?: any, range?: string) {
    if (from && to) {
      return this.getHistory(session, from, to, blockId, query, range);
    }
    return this.getLiveStats(session, blockId, query);
  }

  async getLiveStats(session: ScopedSession, blockId?: string, query?: any) {
    return this.prisma.withScopedSession(session, async (tx) => {
      let blocksQuery: any = blockId ? { id: blockId } : { id: { not: 'chalet' } };

      if (session.role === 'sub_admin') {
        const adminUser = await tx.adminUser.findUnique({
          where: { id: session.adminId },
          include: { assignments: true },
        });
        const assignedBlocks = adminUser?.assignments?.map((a) => a.blockId).filter((id) => id !== 'chalet') || [];
        if (blockId && !assignedBlocks.includes(blockId)) {
          return {
            ok: true,
            stats: [],
            totals: { available: 0, reserved: 0, booked: 0, allotted: 0, disputedTotal: 0, total: 0 },
            total: 0,
            page: 1,
            pageSize: 10,
          };
        }
        blocksQuery = { id: blockId ? blockId : { in: assignedBlocks } };
      }

      // Fetch every block this admin is allowed to see (not just the current page)
      const allAccessibleBlocks = await tx.block.findMany({
        where: blocksQuery,
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });

      const allBlockIds = allAccessibleBlocks.map((b) => b.id);
      if (allBlockIds.length === 0) {
        return {
          ok: true,
          stats: [],
          totals: { available: 0, reserved: 0, booked: 0, allotted: 0, disputedTotal: 0, total: 0 },
          total: 0,
          page: 1,
          pageSize: 10,
        };
      }

      // Read current status counts directly from the Plot table at the moment of request
      const livePlotGrouped = await tx.plot.groupBy({
        by: ['blockId', 'status'],
        where: { blockId: { in: allBlockIds } },
        _count: { id: true },
      });

      // Overall totals across every block the admin is allowed to see
      const totals: InventoryTotals = {
        available: 0,
        reserved: 0,
        booked: 0,
        allotted: 0,
        disputedTotal: 0,
        total: 0,
      };

      const statsMap = new Map<string, InventoryBlockStats>();
      for (const b of allAccessibleBlocks) {
        statsMap.set(b.id, {
          blockId: b.id,
          blockName: b.name,
          available: 0,
          reserved: 0,
          booked: 0,
          allotted: 0,
          disputedTotal: 0,
        });
      }

      for (const row of livePlotGrouped) {
        const count = row._count.id;
        const bStat = statsMap.get(row.blockId);

        if (row.status === 'available') {
          totals.available += count;
          if (bStat) bStat.available += count;
        } else if (row.status === 'reserved') {
          totals.reserved += count;
          if (bStat) bStat.reserved += count;
        } else if (row.status === 'booked') {
          totals.booked += count;
          if (bStat) bStat.booked += count;
        } else if (row.status === 'allotted') {
          totals.allotted += count;
          if (bStat) bStat.allotted += count;
        } else if (row.status === 'disputed') {
          totals.disputedTotal += count;
          if (bStat) bStat.disputedTotal += count;
        }
      }

      totals.total = totals.available + totals.reserved + totals.booked + totals.allotted;

      const page = Math.max(1, parseInt(query?.page || '1', 10));
      const pageSize = query?.pageSize ? parseInt(query.pageSize, 10) : 10;
      const allStats = Array.from(statsMap.values());
      const totalBlocks = allStats.length;

      const paginatedStats = (query?.page && query?.pageSize)
        ? allStats.slice((page - 1) * pageSize, page * pageSize)
        : allStats;

      return {
        ok: true,
        stats: paginatedStats,
        totals,
        total: totalBlocks,
        page,
        pageSize,
      };
    });
  }

  async getHistory(
    session: ScopedSession,
    from?: string,
    to?: string,
    blockId?: string,
    query?: any,
    range?: string,
  ) {
    return this.prisma.withScopedSession(session, async (tx) => {
      let blocksQuery: any = blockId ? { id: blockId } : { id: { not: 'chalet' } };

      if (session.role === 'sub_admin') {
        const adminUser = await tx.adminUser.findUnique({
          where: { id: session.adminId },
          include: { assignments: true },
        });
        const assignedBlocks = adminUser?.assignments?.map((a) => a.blockId).filter((id) => id !== 'chalet') || [];
        if (blockId && !assignedBlocks.includes(blockId)) {
          return {
            ok: true,
            stats: [],
            totals: { available: 0, reserved: 0, booked: 0, allotted: 0, disputedTotal: 0, total: 0 },
            monthly: [],
            total: 0,
            page: 1,
            pageSize: 10,
          };
        }
        blocksQuery = { id: blockId ? blockId : { in: assignedBlocks } };
      }

      const allAccessibleBlocks = await tx.block.findMany({
        where: blocksQuery,
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });

      const allBlockIds = allAccessibleBlocks.map((b) => b.id);
      if (allBlockIds.length === 0) {
        return {
          ok: true,
          stats: [],
          totals: { available: 0, reserved: 0, booked: 0, allotted: 0, disputedTotal: 0, total: 0 },
          monthly: [],
          total: 0,
          page: 1,
          pageSize: 10,
        };
      }

      const now = new Date();
      let startYear: number;
      let startMonth: number;
      const endYear = now.getFullYear();
      const endMonth = now.getMonth();

      if (from && to && !range) {
        const fromD = new Date(from);
        startYear = fromD.getFullYear();
        startMonth = fromD.getMonth();
      } else if (range === '1_year') {
        const d = new Date(now.getFullYear(), now.getMonth() - 11, 1);
        startYear = d.getFullYear();
        startMonth = d.getMonth();
      } else if (range === 'all_time') {
        const firstHistoryRow = await tx.plotStatusHistory.findFirst({
          where: { plot: { blockId: { in: allBlockIds } } },
          orderBy: { changedAt: 'asc' },
          select: { changedAt: true },
        });
        if (firstHistoryRow) {
          const d = new Date(firstHistoryRow.changedAt);
          startYear = d.getFullYear();
          startMonth = d.getMonth();
        } else {
          startYear = now.getFullYear();
          startMonth = now.getMonth();
        }
      } else {
        // default: '6_months'
        const d = new Date(now.getFullYear(), now.getMonth() - 5, 1);
        startYear = d.getFullYear();
        startMonth = d.getMonth();
      }

      const months: Array<{
        month: string;
        label: string;
        year: number;
        start: Date;
        end: Date;
      }> = [];

      let curY = startYear;
      let curM = startMonth;

      while (curY < endYear || (curY === endYear && curM <= endMonth)) {
        const mDate = new Date(curY, curM, 1);
        const mStart = new Date(curY, curM, 1, 0, 0, 0, 0);
        const mEnd = new Date(curY, curM + 1, 0, 23, 59, 59, 999);
        const shortName = mDate.toLocaleString('en-US', { month: 'short' });
        const label = (range === 'all_time' && startYear !== endYear)
          ? `${shortName} '${String(curY).slice(-2)}`
          : shortName;

        months.push({
          month: `${curY}-${String(curM + 1).padStart(2, '0')}`,
          label,
          year: curY,
          start: mStart,
          end: mEnd,
        });

        curM++;
        if (curM > 11) {
          curM = 0;
          curY++;
        }
      }

      const fromStart = from ? new Date(from) : (months[0]?.start || new Date());
      fromStart.setHours(0, 0, 0, 0);

      const toEnd = to ? new Date(to) : (months[months.length - 1]?.end || new Date());
      toEnd.setHours(23, 59, 59, 999);

      const maxEnd = months.length > 0 ? months[months.length - 1].end : toEnd;

      // 1. Grouped block stats
      const statsRes = await tx.$queryRaw<any[]>`
        SELECT
          p."blockId",
          COUNT(DISTINCT CASE WHEN psh."toStatus" = 'booked' AND psh."changedAt" >= ${fromStart} AND psh."changedAt" <= ${toEnd} THEN psh."plotId" END) as booked,
          COUNT(DISTINCT CASE WHEN psh."toStatus" = 'allotted' AND psh."changedAt" >= ${fromStart} AND psh."changedAt" <= ${toEnd} THEN psh."plotId" END) as allotted,
          COUNT(DISTINCT CASE WHEN psh."toStatus" = 'reserved' AND psh."changedAt" >= ${fromStart} AND psh."changedAt" <= ${toEnd} THEN psh."plotId" END) as reserved,
          COUNT(DISTINCT CASE WHEN latest."toStatus" = 'available' THEN p."id" END) as available,
          COUNT(DISTINCT CASE WHEN latest."toStatus" = 'disputed' THEN p."id" END) as disputed
        FROM "Plot" p
        LEFT JOIN "PlotStatusHistory" psh ON psh."plotId" = p."id"
        LEFT JOIN (
          SELECT "plotId", "toStatus",
                 ROW_NUMBER() OVER(PARTITION BY "plotId" ORDER BY "changedAt" DESC) as rn
          FROM "PlotStatusHistory"
          WHERE "changedAt" <= ${toEnd}
        ) latest ON latest."plotId" = p."id" AND latest.rn = 1
        WHERE p."blockId" IN (${Prisma.join(allBlockIds)})
        GROUP BY p."blockId"
      `;

      const results: InventoryBlockStats[] = [];
      const totals: InventoryTotals = {
        available: 0,
        reserved: 0,
        booked: 0,
        allotted: 0,
        disputedTotal: 0,
        total: 0,
      };

      for (const block of allAccessibleBlocks) {
        const row = statsRes.find((r) => r.blockId === block.id);
        const booked = Number(row?.booked || 0);
        const allotted = Number(row?.allotted || 0);
        const reserved = Number(row?.reserved || 0);
        const available = Number(row?.available || 0);
        const disputedTotal = Number(row?.disputed || 0);

        results.push({
          blockId: block.id,
          blockName: block.name,
          booked,
          allotted,
          reserved,
          available,
          disputedTotal,
        });

        totals.booked += booked;
        totals.allotted += allotted;
        totals.reserved += reserved;
        totals.available += available;
        totals.disputedTotal += disputedTotal;
      }

      totals.total = totals.available + totals.reserved + totals.booked + totals.allotted;

      // 2. Monthly timeline series aggregation
      const historyRows = await tx.$queryRaw<Array<{
        plotId: string;
        toStatus: string;
        changedAt: Date;
        category: string;
      }>>`
        SELECT psh."plotId", psh."toStatus", psh."changedAt", p."category"
        FROM "PlotStatusHistory" psh
        JOIN "Plot" p ON p."id" = psh."plotId"
        WHERE p."blockId" IN (${Prisma.join(allBlockIds)})
          AND psh."changedAt" <= ${maxEnd}
        ORDER BY psh."changedAt" ASC
      `;

      const monthly: MonthlyHistoryPoint[] = months.map((m) => {
        const mStartMs = m.start.getTime();
        const mEndMs = m.end.getTime();

        const reservedPlotIds = new Set<string>();
        const bookedPlotIds = new Set<string>();
        const latestStatusMap = new Map<string, string>();

        for (const row of historyRows) {
          const time = new Date(row.changedAt).getTime();
          if (time <= mEndMs) {
            if (row.category !== 'amenity') {
              latestStatusMap.set(row.plotId, row.toStatus);
            }
            if (time >= mStartMs) {
              if (row.toStatus === 'reserved') {
                reservedPlotIds.add(row.plotId);
              } else if (row.toStatus === 'booked') {
                bookedPlotIds.add(row.plotId);
              }
            }
          }
        }

        let availableCount = 0;
        for (const st of latestStatusMap.values()) {
          if (st === 'available') {
            availableCount++;
          }
        }

        return {
          month: m.month,
          label: m.label,
          year: m.year,
          available: availableCount,
          reserved: reservedPlotIds.size,
          booked: bookedPlotIds.size,
        };
      });

      const page = Math.max(1, parseInt(query?.page || '1', 10));
      const pageSize = query?.pageSize ? parseInt(query.pageSize, 10) : 10;
      const totalBlocks = results.length;
      const paginatedStats = (query?.page && query?.pageSize)
        ? results.slice((page - 1) * pageSize, page * pageSize)
        : results;

      return {
        ok: true,
        stats: paginatedStats,
        totals,
        monthly,
        total: totalBlocks,
        page,
        pageSize,
      };
    });
  }
}
