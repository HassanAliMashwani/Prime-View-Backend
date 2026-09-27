import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService, ScopedSession } from '../prisma/prisma.service';

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats(session: ScopedSession, from?: string, to?: string, blockId?: string) {
    return this.prisma.withScopedSession(session, async (tx) => {
      const adminUser = await tx.adminUser.findUnique({ where: { id: session.adminId }, include: { assignments: true } });
      
      let blocksQuery: any = blockId ? { id: blockId } : {};
      if (session.role === 'sub_admin') {
        if (!adminUser) throw new BadRequestException(`Sub-admin user not found in DB (id=${session.adminId})`);
        const assignedBlocks = adminUser.assignments.map(a => a.blockId);
        if (blockId && !assignedBlocks.includes(blockId)) return [];
        blocksQuery = { id: blockId ? blockId : { in: assignedBlocks } };
      }

      const accessibleBlocks = await tx.block.findMany({
        where: blocksQuery,
        select: { id: true, name: true }
      });

      const blockIds = accessibleBlocks.map(b => b.id);
      if (blockIds.length === 0) return [];

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

        return Array.from(statsByBlock.values());
      }

      // Historical Range Mode
      const fromStart = new Date(from);
      fromStart.setHours(0, 0, 0, 0); // Start of day

      const toEnd = new Date(to);
      toEnd.setHours(23, 59, 59, 999); // End of day

      const results = [];

      for (const block of accessibleBlocks) {
        // Booked
        const bookedRes = await tx.$queryRaw<{count: bigint}[]>`
          SELECT COUNT(DISTINCT "plotId") as count
          FROM "PlotStatusHistory" psh
          JOIN "Plot" p ON psh."plotId" = p."id"
          WHERE p."blockId" = ${block.id}
            AND psh."toStatus" = 'booked'
            AND psh."changedAt" >= ${fromStart}
            AND psh."changedAt" <= ${toEnd}
        `;
        const booked = Number(bookedRes[0]?.count || 0);

        // Allotted
        const allottedRes = await tx.$queryRaw<{count: bigint}[]>`
          SELECT COUNT(DISTINCT "plotId") as count
          FROM "PlotStatusHistory" psh
          JOIN "Plot" p ON psh."plotId" = p."id"
          WHERE p."blockId" = ${block.id}
            AND psh."toStatus" = 'allotted'
            AND psh."changedAt" >= ${fromStart}
            AND psh."changedAt" <= ${toEnd}
        `;
        const allotted = Number(allottedRes[0]?.count || 0);

        // Reserved
        const reservedRes = await tx.$queryRaw<{count: bigint}[]>`
          SELECT COUNT(DISTINCT "plotId") as count
          FROM "PlotStatusHistory" psh
          JOIN "Plot" p ON psh."plotId" = p."id"
          WHERE p."blockId" = ${block.id}
            AND psh."toStatus" = 'reserved'
            AND psh."changedAt" >= ${fromStart}
            AND psh."changedAt" <= ${toEnd}
        `;
        const reserved = Number(reservedRes[0]?.count || 0);

        // Available as of toEnd
        const availableRes = await tx.$queryRaw<{count: bigint}[]>`
          SELECT COUNT(*) as count
          FROM (
            SELECT psh."plotId", psh."toStatus",
                   ROW_NUMBER() OVER(PARTITION BY psh."plotId" ORDER BY psh."changedAt" DESC) as rn
            FROM "PlotStatusHistory" psh
            JOIN "Plot" p ON psh."plotId" = p."id"
            WHERE p."blockId" = ${block.id}
              AND psh."changedAt" <= ${toEnd}
          ) sub
          WHERE rn = 1 AND "toStatus" = 'available'
        `;
        const available = Number(availableRes[0]?.count || 0);

        // Disputed as of toEnd
        const disputedRes = await tx.$queryRaw<{count: bigint}[]>`
          SELECT COUNT(*) as count
          FROM (
            SELECT psh."plotId", psh."toStatus",
                   ROW_NUMBER() OVER(PARTITION BY psh."plotId" ORDER BY psh."changedAt" DESC) as rn
            FROM "PlotStatusHistory" psh
            JOIN "Plot" p ON psh."plotId" = p."id"
            WHERE p."blockId" = ${block.id}
              AND psh."changedAt" <= ${toEnd}
          ) sub
          WHERE rn = 1 AND "toStatus" = 'disputed'
        `;
        const disputedTotal = Number(disputedRes[0]?.count || 0);

        results.push({
          blockId: block.id,
          blockName: block.name,
          booked,
          allotted,
          reserved,
          available,
          disputedTotal,
        });
      }

      return results;
    });
  }
}
