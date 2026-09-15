/**
 * Vercel Serverless Entry Point for NestJS.
 *
 * Vercel does NOT support long-running servers (app.listen).
 * This file bootstraps NestJS once, caches the Express adapter,
 * and exports a handler that Vercel calls per-request.
 */
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { TypedErrorFilter } from './common/filters/typed-error.filter';
import type { IncomingMessage, ServerResponse } from 'http';

let app: NestExpressApplication | undefined;

async function getApp(): Promise<NestExpressApplication> {
  if (!app) {
    app = await NestFactory.create<NestExpressApplication>(AppModule, {
      logger: ['error', 'warn'],
    });
    app.useBodyParser('json', { limit: '15mb' });
    app.useBodyParser('urlencoded', { extended: true, limit: '15mb' });
    app.enableCors();
    app.useGlobalFilters(new TypedErrorFilter());
    await app.init();
  }
  return app;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const nestApp = await getApp();
  const expressApp = nestApp.getHttpAdapter().getInstance();
  expressApp(req, res);
}
