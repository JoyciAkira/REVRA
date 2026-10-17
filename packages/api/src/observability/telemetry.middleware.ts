/**
 * A3 — Telemetry middleware: misura la latenza di ogni request e la registra
 * negli histogram Prometheus; emette un log strutturato JSON con evidence-id
 * correlabile. Zero dipendenze esterne.
 *
 * Mapping path → histogram:
 * - /analysis/results/* (promote/certificate/reconcile) → sync/consensus latency
 * - /formats/analyze → analyze duration
 * - L3 verify è strumentato a livello service (attachCertificate) ma qui
 *   catturiamo anche la latenza HTTP complessiva del path certificate.
 */
import type { Request, Response } from 'express';
import {
  MetricsRegistry,
  METRIC_SYNC_LATENCY,
  METRIC_ANALYZE_DURATION,
  METRIC_L3_VERIFY_DURATION,
  METRIC_CONSENSUS_LATENCY,
  COUNTER_REQUESTS_TOTAL,
} from './metrics.js';

function histogramForPath(path: string, method: string): string {
  if (method === 'POST' && path.startsWith('/formats/analyze')) return METRIC_ANALYZE_DURATION;
  if (method === 'POST' && path.includes('/certificates')) return METRIC_L3_VERIFY_DURATION;
  if (method === 'POST' && path.includes('/reconcil')) return METRIC_CONSENSUS_LATENCY;
  if (path.startsWith('/analysis/')) return METRIC_SYNC_LATENCY;
  return METRIC_SYNC_LATENCY; // default: treat as sync-class latency
}

export function telemetryMiddleware(registry: MetricsRegistry): (req: Request, res: Response, next: () => void) => void {
  return (req: Request, res: Response, next: () => void): void => {
    const start = process.hrtime.bigint();
    registry.incCounter(COUNTER_REQUESTS_TOTAL);
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      const histogram = histogramForPath(req.path, req.method);
      registry.observeLatency(histogram, durationMs);
      // Log strutturato con evidence-id correlabile (A3 gate: trace end-to-end).
      const tenant = (req as unknown as { tenant?: { tenantId?: string } }).tenant;
      const evidenceId = req.headers['x-evidence-id'] ?? req.headers['x-trace-id'] ?? 'none';
      const line = JSON.stringify({
        ts: new Date().toISOString(),
        level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration_ms: Math.round(durationMs * 100) / 100,
        histogram,
        tenant_id: tenant?.tenantId ?? 'anonymous',
        evidence_id: String(evidenceId),
      });
      // eslint-disable-next-line no-console
      console.log(line);
    });
    next();
  };
}