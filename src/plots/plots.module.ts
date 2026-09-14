import { Module } from '@nestjs/common';
import { PlotsController } from './plots.controller';
import { PlotsService } from './plots.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [PlotsController],
  providers: [PlotsService, PrismaService],
  exports: [PlotsService],
})
export class PlotsModule {}
