import { Module } from '@nestjs/common';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';
import { PlotsModule } from '../plots/plots.module';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  imports: [PlotsModule],
  controllers: [ReservationsController],
  providers: [ReservationsService, PrismaService],
  exports: [ReservationsService],
})
export class ReservationsModule {}
