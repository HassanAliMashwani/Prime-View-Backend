import { Module } from '@nestjs/common';
import { ReceiptsController } from './receipts.controller';
import { ReceiptsService } from './receipts.service';
import { PrismaService } from '../prisma/prisma.service';

import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule],
  controllers: [ReceiptsController],
  providers: [ReceiptsService, PrismaService],
  exports: [ReceiptsService],
})
export class ReceiptsModule {}
