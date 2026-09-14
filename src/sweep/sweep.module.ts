import { Module } from '@nestjs/common';
import { SweepService } from './sweep.service';
import { SweepController } from './sweep.controller';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [RealtimeModule],
  controllers: [SweepController],
  providers: [SweepService, PrismaService],
  exports: [SweepService],
})
export class SweepModule {}
