import * as fs from 'fs';
import * as path from 'path';

// Load .env automatically if present
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { TypedErrorFilter } from './common/filters/typed-error.filter';

async function bootstrap() {
  // Production JWT secret verification - refuse to boot on missing or known placeholder secrets
  const isProd = process.env.NODE_ENV === 'production';
  const jwtSecret = process.env.JWT_SECRET;
  const knownPlaceholders = [
    'super-secret-default-key-for-dev',
    'secret',
    'changeme',
    'your-secret-key',
    'placeholder',
    'jwt-secret',
    'default',
  ];

  if (isProd) {
    if (!jwtSecret || knownPlaceholders.includes(jwtSecret.toLowerCase()) || jwtSecret.length < 32) {
      throw new Error(
        '[FATAL SECURITY ERROR] Production refuses to boot: JWT_SECRET is missing, insecure, or a known placeholder.',
      );
    }
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useBodyParser('json', { limit: '15mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '15mb' });

  // Whitelist known origins strictly - no wildcard allowed
  const allowedOrigins = [
    process.env.FRONTEND_URL,
    'https://prime-view-livid.vercel.app',
    !isProd ? 'http://localhost:3000' : undefined,
  ].filter(Boolean) as string[];

  app.enableCors({
    origin: allowedOrigins,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  // Global DTO whitelisting to eliminate mass-assignment vulnerabilities
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: false,
    }),
  );

  app.useGlobalFilters(new TypedErrorFilter());
  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();

