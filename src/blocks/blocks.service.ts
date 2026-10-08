import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BlocksService {
  constructor(private prisma: PrismaService) {}

  async findAll(session: any) {
    const role = session.role;
    const assignedBlocks: string[] = session.assignedBlocks || [];

    if (role !== 'super_admin' && assignedBlocks.length === 0) {
      return [];
    }

    const whereClause =
      role === 'super_admin'
        ? Prisma.sql``
        : Prisma.sql`WHERE b.id IN (${Prisma.join(assignedBlocks)})`;

    return this.prisma.withScopedSession(session, async (tx) => {
      const blocks = await tx.$queryRaw<
        Array<{
          id: string;
          name: string;
          description: string | null;
          totalPlots: number;
          totalCount: number;
          availableCount: number;
          reservedCount: number;
          bookedCount: number;
          allottedCount: number;
          amenityCount: number;
          disputedCount: number;
          amenities: string[] | null;
        }>
      >`
        SELECT 
          b.id,
          b.name,
          b.description,
          COUNT(p.id) FILTER (WHERE p.category != 'amenity')::int as "totalPlots",
          COUNT(p.id) FILTER (WHERE p.category != 'amenity')::int as "totalCount",
          COUNT(p.id) FILTER (WHERE p.category != 'amenity' AND p.status = 'available' AND p."isAdjustment" = false)::int as "availableCount",
          COUNT(p.id) FILTER (WHERE p.category != 'amenity' AND p.status = 'reserved' AND p."isAdjustment" = false)::int as "reservedCount",
          COUNT(p.id) FILTER (WHERE p.category != 'amenity' AND p.status = 'booked' AND p."isAdjustment" = false)::int as "bookedCount",
          COUNT(p.id) FILTER (WHERE p.category != 'amenity' AND p.status = 'allotted' AND p."isAdjustment" = false)::int as "allottedCount",
          COUNT(p.id) FILTER (WHERE p.category = 'amenity')::int as "amenityCount",
          COUNT(p.id) FILTER (WHERE p."isAdjustment" = true)::int as "disputedCount",
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT p."amenityName"), NULL) as amenities
        FROM "Block" b
        LEFT JOIN "Plot" p ON p."blockId" = b.id
        ${whereClause}
        GROUP BY b.id, b.name, b.description
        ORDER BY b.id ASC
      `;

      return blocks.map((block) => {
        return {
          id: block.id,
          name: block.name,
          description: block.description,
          totalPlots: block.totalPlots,
          totalCount: block.totalCount,
          availableCount: block.availableCount,
          reservedCount: block.reservedCount,
          bookedCount: block.bookedCount,
          allottedCount: block.allottedCount,
          amenityCount: block.amenityCount,
          disputedCount: block.disputedCount,
          amenities:
            block.amenities && block.amenities.length > 0
              ? block.amenities
              : ['Central Park', 'Community Mosque'],
        };
      });
    });
  }
}
