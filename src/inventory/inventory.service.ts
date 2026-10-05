import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService, ScopedSession } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats(session: ScopedSession, from?: string, to?: string, blockId?: string, query?: any) {
    return this.prisma.withScopedSession(session, async (tx) => {
      const adminUser = await tx.adminUser.findUnique({ where: { id: session.adminId }, include: { assignments: true } });
      
      let blocksQuery: any = blockId ? { id: blockId } : {};
      if (session.role === 'sub_admin') {
        if (!adminUser) throw new BadRequestException(`Sub-admin user not found in DB (id=${session.adminId})`);
        const assignedBlocks = adminUser.assignments.map(a => a.blockId);
        if (blockId && !assignedBlocks.includes(blockId)) return { ok: true, stats: [], total: 0, page: 1, pageSize: 10 };
        blocksQuery = { id: blockId ? blockId : { in: assignedBlocks } };
      }

      const page = Math.max(1, parseInt(query?.page || '1', 10));
      const pageSize = 10;
      const skip = (page - 1) * pageSize;

      const [accessibleBlocks, totalBlocks] = await Promise.all([
        tx.block.findMany({
          where: blocksQuery,
          select: { id: true, name: true },
          skip,
          take: pageSize,
        }),
        tx.block.count({ where: blocksQuery })
      ]);

      const blockIds = accessibleBlocks.map(b => b.id);
      if (blockIds.length === 0) return { ok: true, stats: [], total: totalBlocks, page, pageSize };

      if (!from || !to) {
        // Snapshot Mode: One grouped query by blockId and status without loading every plot into memory
        const grouped = await tx.plot.groupBy({
          by: ['blockId', 'status'],
          where: { blockId: { in: blockIds } },
          _count: { id: true },
        });

        const statsByBlock = new Map();
        for (const b of accessibleBlocks) {
          statsByBlock.set(b.id, {
            blockId: b.id,
            blockName: b.name,
            booked: 0,
            allotted: 0,
            reserved: 0,
            available: 0,
            disputedTotal: 0,
          });
        }

        for (const row of grouped) {
          const st = statsByBlock.get(row.blockId);
          if (!st) continue;
          const count = row._count.id;
          if (row.status === 'booked') st.booked += count;
          else if (row.status === 'allotted') st.allotted += count;
          else if (row.status === 'reserved') st.reserved += count;
          else if (row.status === 'available') st.available += count;
          else if (row.status === 'disputed') st.disputedTotal += count;
        }

        return { ok: true, stats: Array.from(statsByBlock.values()), total: totalBlocks, page, pageSize };
      }

      // Historical Range Mode
      const fromStart = new Date(from);
      fromStart.setHours(0, 0, 0, 0); // Start of day

      const toEnd = new Date(to);
      toEnd.setHours(23, 59, 59, 999); // End of day

      const results = [];
      const blockIdsArray = accessibleBlocks.map(b => b.id);
      
      const statsRes = await tx.$queryRaw<any[]>`
        SELECT
          p."blockId",
          COUNT(DISTINCT CASE WHEN psh."toStatus" = 'booked' AND psh."changedAt" >= ${fromStart} AND psh."changedAt" <= ${toEnd} THEN psh."plotId" END) as booked,
          COUNT(DISTINCT CASE WHEN psh."toStatus" = 'allotted' AND psh."changedAt" >= ${fromStart} AND psh."changedAt" <= ${toEnd} THEN psh."plotId" END) as allotted,
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
        WHERE p."blockId" IN (${Prisma.join(blockIdsArray)})
        GROUP BY p."blockId"
      `;

      for (const block of accessibleBlocks) {
        const row = statsRes.find(r => r.blockId === block.id);
        results.push({
          blockId: block.id,
          blockName: block.name,
          booked: Number(row?.booked || 0),
          allotted: Number(row?.allotted || 0),
          reserved: Number(row?.reserved || 0),
          available: Number(row?.available || 0),
          disputedTotal: Number(row?.disputed || 0),
        });
      }

      return { ok: true, stats: results, total: totalBlocks, page, pageSize };
    });
  }
}
