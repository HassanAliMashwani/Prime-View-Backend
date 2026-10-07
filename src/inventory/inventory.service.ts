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

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats(session: ScopedSession, from?: string, to?: string, blockId?: string, query?: any) {
    if (from && to) {
      return this.getHistory(session, from, to, blockId, query);
    }
    return this.getLiveStats(session, blockId, query);
  }

  async getLiveStats(session: ScopedSession, blockId?: string, query?: any) {
    return this.prisma.withScopedSession(session, async (tx) => {
      let blocksQuery: any = blockId ? { id: blockId } : {};

      if (session.role === 'sub_admin') {
        const adminUser = await tx.adminUser.findUnique({
          where: { id: session.adminId },
          include: { assignments: true },
        });
        const assignedBlocks = adminUser?.assignments?.map((a) => a.blockId) || [];
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

  async getHistory(session: ScopedSession, from: string, to: string, blockId?: string, query?: any) {
    return this.prisma.withScopedSession(session, async (tx) => {
      let blocksQuery: any = blockId ? { id: blockId } : {};

      if (session.role === 'sub_admin') {
        const adminUser = await tx.adminUser.findUnique({
          where: { id: session.adminId },
          include: { assignments: true },
        });
        const assignedBlocks = adminUser?.assignments?.map((a) => a.blockId) || [];
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

      const fromStart = new Date(from);
      fromStart.setHours(0, 0, 0, 0);

      const toEnd = new Date(to);
      toEnd.setHours(23, 59, 59, 999);

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
        total: totalBlocks,
        page,
        pageSize,
      };
    });
  }
}
