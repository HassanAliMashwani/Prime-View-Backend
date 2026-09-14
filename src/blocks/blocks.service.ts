import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BlocksService {
  constructor(private prisma: PrismaService) {}

  async findAll(session: any) {
    const role = session.role;
    const assignedBlocks = session.assignedBlocks || [];
    const where = role === 'super_admin' ? {} : { id: { in: assignedBlocks } };

    return this.prisma.withScopedSession(session, async (tx) => {
      const blocks = await tx.block.findMany({
        where,
        include: {
          plots: {
            select: {
              id: true,
              status: true,
              category: true,
              amenityName: true,
              isAdjustment: true,
            },
          },
        },
        orderBy: { id: 'asc' },
      });

      return blocks.map((block) => {
        const sellablePlots = block.plots.filter((p) => p.category !== 'amenity');
        const availableCount = sellablePlots.filter((p) => p.status === 'available').length;
        const reservedCount = sellablePlots.filter((p) => p.status === 'reserved').length;
        const bookedCount = sellablePlots.filter((p) => p.status === 'booked').length;
        const amenityPlots = block.plots.filter((p) => p.category === 'amenity');
        const amenityCount = amenityPlots.length;
        const totalCount = sellablePlots.length;
        const disputedCount = block.plots.filter((p) => p.isAdjustment).length;

        const extractedAmenities = Array.from(
          new Set(
            amenityPlots
              .map((p) => p.amenityName)
              .filter((name): name is string => Boolean(name)),
          ),
        );

        return {
          id: block.id,
          name: block.name,
          description: block.description,
          totalPlots: block.totalPlots, // descriptive capacity preserved
          totalCount, // live aggregate of actual seeded sellable plots
          availableCount,
          reservedCount,
          bookedCount,
          amenityCount,
          disputedCount,
          amenities: extractedAmenities.length > 0 ? extractedAmenities : ['Central Park', 'Community Mosque'],
        };
      });
    });
  }
}
