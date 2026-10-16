import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface HealthCheckResult {
  ok: boolean;
  checks: {
    database: 'pass' | 'fail';
    signingSecret: 'pass' | 'fail';
    verifyOrigin: 'pass' | 'fail';
  };
}

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async checkHealth(): Promise<HealthCheckResult> {
    let database: 'pass' | 'fail' = 'pass';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'fail';
    }

    const secret = process.env.RECEIPT_HMAC_SECRET_V1?.trim();
    const signingSecret: 'pass' | 'fail' = secret ? 'pass' : 'fail';

    const rawOrigin = process.env.PUBLIC_RECEIPT_VERIFY_ORIGIN?.trim();
    let verifyOrigin: 'pass' | 'fail' = 'pass';
    if (
      !rawOrigin ||
      rawOrigin.includes('localhost') ||
      rawOrigin.includes('127.0.0.1') ||
      rawOrigin.includes('192.168')
    ) {
      verifyOrigin = 'fail';
    }

    const ok = database === 'pass' && signingSecret === 'pass' && verifyOrigin === 'pass';

    return {
      ok,
      checks: {
        database,
        signingSecret,
        verifyOrigin,
      },
    };
  }
}
