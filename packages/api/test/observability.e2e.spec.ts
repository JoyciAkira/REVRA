/**
 * A3 — Observability & SLO: endpoint /metrics (Prometheus text format),
 * /slo (report markdown + JSON), timing per-request registrato negli
 * histogram, gate SLO misurabile (sync <50ms p95, L3 verify <60s).
 */
import 'reflect-metadata';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureRevraApp } from '../src/app.setup.js';
import { JwtAuthService } from '../src/auth/auth.service.js';
import { AuditService } from '../src/audit/audit.service.js';
import { MetricsRegistry, METRIC_SYNC_LATENCY, buildSloReport } from '../src/observability/metrics.js';
import { METRICS_REGISTRY } from '../src/observability/tokens.js';

process.env.REVRA_DB = join(mkdtempSync(join(tmpdir(), 'revra-a3-')), 'state.db');

let app: INestApplication;
let registry: MetricsRegistry;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ logger: ['error', 'warn'] });
  // Usa l'istanza DI del registry: è la stessa che il controller /metrics
  // legge e che il middleware popola — altrimenti vedono oggetti diversi.
  registry = moduleRef.get<MetricsRegistry>(METRICS_REGISTRY);
  configureRevraApp(app, {
    jwt: moduleRef.get(JwtAuthService),
    audit: moduleRef.get(AuditService),
    metrics: registry,
  });
  await app.init();
});

afterAll(async () => {
  await app.close();
  delete process.env.REVRA_DB;
});

describe('A3 — Observability & SLO', () => {
  it('/metrics espone Prometheus text format con histogram dopo request', async () => {
    // Genera traffico per popolare gli histogram.
    await request(app.getHttpServer()).get('/analysis/results');
    await request(app.getHttpServer()).get('/formats/matrix');

    const res = await request(app.getHttpServer()).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    // Formato Prometheus: TYPE histogram + bucket + sum + count.
    expect(res.text).toContain('# TYPE revra_requests_total counter');
    expect(res.text).toContain('revra_requests_total');
    expect(res.text).toMatch(/_bucket\{le="/);
    expect(res.text).toContain('_sum');
    expect(res.text).toContain('_count');
  });

  it('timing per-request: le request popolano l\'histogram di latenza', async () => {
    registry.reset();
    // N request per avere campioni nell'histogram sync.
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer()).get('/analysis/results');
    }
    expect(registry.count(METRIC_SYNC_LATENCY)).toBeGreaterThanOrEqual(5);
    const p95 = registry.percentile(METRIC_SYNC_LATENCY, 0.95);
    expect(p95).not.toBeNull();
    // Gate A3: sync <50ms p95 su operazioni in-memory locali.
    expect(p95!).toBeLessThan(50);
  });

  it('/slo/json ritorna report machine-readable con target PRD §11', async () => {
    registry.reset();
    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer()).get('/analysis/results');
    }
    const res = await request(app.getHttpServer()).get('/slo/json');
    expect(res.status).toBe(200);
    const entries = res.body as ReturnType<typeof buildSloReport>;
    expect(Array.isArray(entries)).toBe(true);
    // Contiene i target PRD §11 / roadmap A3.
    const labels = entries.map((e) => e.label);
    expect(labels.some((l) => l.includes('sync <50ms'))).toBe(true);
    expect(labels.some((l) => l.includes('L3 verify <60s'))).toBe(true);
    // Con dati sufficienti, lo SLO sync è valutato (met !== null).
    const syncEntry = entries.find((e) => e.label.includes('sync <50ms'));
    expect(syncEntry?.met).toBe(true); // operazioni locali veloci
  });

  it('/slo ritorna report markdown settimanale (artefatto auto-generato, gate A3)', async () => {
    const res = await request(app.getHttpServer()).get('/slo');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/markdown');
    expect(res.text).toContain('# REVRA SLO Report');
    expect(res.text).toContain('| SLO |');
    expect(res.text).toMatch(/✅ met|❌ breached|⚠️ no data/);
  });

  it('log strutturato: evidence-id correlabile emesso (verifica indiretta via nessun crash)', async () => {
    // Il middleware emette console.log JSON; qui verifichiamo che una request
    // con header x-evidence-id completi senza errori (il log è side-effect).
    const res = await request(app.getHttpServer())
      .get('/analysis/results')
      .set('x-evidence-id', 'ev-test-a3-001');
    expect(res.status).not.toBe(500);
  });
});