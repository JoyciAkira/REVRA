import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureRevraApp } from './app.setup.js';
import { JwtAuthService } from './auth/auth.service.js';
import { AuditService } from './audit/audit.service.js';
import { MetricsRegistry } from './observability/metrics.js';
import { METRICS_REGISTRY } from './observability/tokens.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureRevraApp(app, {
    jwt: app.get(JwtAuthService, { strict: false }),
    audit: app.get(AuditService, { strict: false }),
    metrics: app.get(METRICS_REGISTRY, { strict: false }) ?? new MetricsRegistry(),
  });
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`revra-api listening on :${port}`);
}

void bootstrap();
