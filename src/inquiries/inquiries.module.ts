import { Module } from '@nestjs/common';
import { InquiriesController } from './inquiries.controller';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [InquiriesController],
  providers: [PrismaService],
})
export class InquiriesModule {}
