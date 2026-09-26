import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async checkHealth(): Promise<{ ok: boolean }> {
    await this.prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  }
}
