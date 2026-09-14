import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { StorageController } from './storage.controller';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [StorageController],
  providers: [StorageService, PrismaService],
  exports: [StorageService],
})
export class StorageModule {}
