/**
 * Configurazione condivisa dell'applicazione (main + test e2e): JSON parser,
 * auth middleware (secure mode se REVRA_JWT_SECRET è impostato), audit
 * middleware, shutdown hooks — ciò che testi è ciò che giri.
 */
import { json } from 'express';
import { type INestApplication } from '@nestjs/common';
import type { JwtAuthService } from './auth/auth.service.js';
import { authMiddleware } from './auth/auth.middleware.js';
import { auditMiddleware } from './audit/audit.middleware.js';
import type { AuditService } from './audit/audit.service.js';
import { telemetryMiddleware } from './observability/telemetry.middleware.js';
import type { MetricsRegistry } from './observability/metrics.js';
import { ReliabilityExceptionFilter } from './analysis/reliability-exception.filter.js';

export interface RevraAppDeps {
  jwt: JwtAuthService;
  audit: AuditService;
  metrics: MetricsRegistry;
}

export function configureRevraApp(app: INestApplication, deps: RevraAppDeps): void {
  // json() esplicito e idempotente: garantisce req.body qualunque sia
  // l'ordine di montaggio rispetto al parser interno di Nest.
  app.use(json());
  app.use(authMiddleware(deps.jwt, Boolean(process.env.REVRA_JWT_SECRET)));
  app.use(telemetryMiddleware(deps.metrics));
  app.use(auditMiddleware(deps.audit));
 // A4: filtro eccezioni GLOBALE — cattura OGNI throw non gestito su OGNI endpoint
 // (non solo quelli con @UseFilters) e lo traduce in 4xx/contratto invece di 500.
 // Chiude il gate fuzzing: payload patologico → MALFORMED_INPUT/INVALID_PAYLOAD, mai crash.
 app.useGlobalFilters(new ReliabilityExceptionFilter());
  app.enableShutdownHooks();
}
