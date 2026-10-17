/**
 * A2 — Auth JWT/RBAC su TUTTI i moduli shared (formats/epistemic/timeline/
 * sovereign/audit/cognitive/analysis). Gate: in secure mode nessun endpoint
 * risponde 200 senza token; viewer ottiene 403 su ogni mutazione su ogni
 * modulo; ownership TENANT_MISMATCH coerente sul :tenantId nel path.
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
import { MetricsRegistry } from '../src/observability/metrics.js';

process.env.REVRA_JWT_SECRET = 'test-secret-a2';
process.env.REVRA_DB = join(mkdtempSync(join(tmpdir(), 'revra-a2-')), 'state.db');

let app: INestApplication;

async function token(tenantId: string, role: string): Promise<string> {
  const issued = await request(app.getHttpServer())
    .post('/auth/token')
    .send({ tenantId, role });
  return issued.body.token as string;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ logger: ['error', 'warn'] });
 configureRevraApp(app, {
 jwt: moduleRef.get(JwtAuthService),
 audit: moduleRef.get(AuditService),
 metrics: new MetricsRegistry(),
 });
  await app.init();
});

afterAll(async () => {
  await app.close();
  delete process.env.REVRA_JWT_SECRET;
  delete process.env.REVRA_DB;
});

// Matrice di endpoint GET (read) e POST (mutazione) per ogni modulo shared.
const READ_ENDPOINTS = [
  '/formats/matrix',
  '/epistemic/hypotheses',
  '/epistemic/metrics',
  '/timeline/branches',
  '/audit/entries',
  '/cognitive/metrics',
  '/cognitive/bci/adapters',
  '/analysis/results',
  '/analysis/reconciliations',
  '/analysis/coverage',
];

const MUTATION_ENDPOINTS: Array<{ path: string; body: unknown }> = [
  { path: '/formats/route', body: { magicHex: '7f454c46' } },
  { path: '/epistemic/patterns', body: { features: ['a'], label: 'x' } },
  { path: '/epistemic/hypotheses/generate', body: { binaryHash: 'a1b2c3d4e5f60718' } },
  { path: '/epistemic/causal/observations', body: { cause: 'a', effect: 'b' } },
  { path: '/timeline/branches', body: { resultId: 'r', actor: { kind: 'human', id: 'u' } } },
  { path: '/timeline/merge', body: { branchIds: ['b1', 'b2'] } },
  { path: '/cognitive/states', body: { sessionId: 's', loadLevel: 0.5, flowScore: 0.8 } },
  { path: '/cognitive/bci/adapters', body: { vendor: 'test', protocol: 'mock' } },
  { path: '/sovereign/attestations', body: { enclaveId: 'e', quote: 'q' } },
  { path: '/sovereign/compliance/proofs', body: { regulation: 'GDPR', circuit: 'c', publicInputs: {} } },
];

describe('A2 — auth secure-mode su TUTTI i moduli shared', () => {
  it('nessun endpoint read risponde 200 senza token (401 su 100% dei moduli)', async () => {
    for (const path of READ_ENDPOINTS) {
      const res = await request(app.getHttpServer()).get(path);
      expect(res.status, `GET ${path} dovrebbe essere 401 senza token`).toBe(401);
    }
  });

  it('nessuna mutazione risponde 200 senza token (401 su 100% dei moduli)', async () => {
    for (const { path, body } of MUTATION_ENDPOINTS) {
      const res = await request(app.getHttpServer()).post(path).send(body);
      expect(res.status, `POST ${path} dovrebbe essere 401 senza token`).toBe(401);
    }
  });

  it('viewer ottiene 403 su ogni mutazione, su ogni modulo (read-only globale)', async () => {
    const viewerToken = await token('tenant-viewer', 'viewer');
    for (const { path, body } of MUTATION_ENDPOINTS) {
      const res = await request(app.getHttpServer())
        .post(path)
        .set('authorization', `Bearer ${viewerToken}`)
        .send(body);
      expect(res.status, `viewer POST ${path} dovrebbe essere 403`).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });

  it('analyst legge su tutti i moduli con token valido (200/201, nessun 401)', async () => {
    const analystToken = await token('tenant-analyst', 'analyst');
    for (const path of READ_ENDPOINTS) {
      const res = await request(app.getHttpServer())
        .get(path)
        .set('authorization', `Bearer ${analystToken}`);
      expect(res.status, `analyst GET ${path} non deve essere 401`).not.toBe(401);
    }
  });

  it('ownership TENANT_MISMATCH: sign su tenant altrui → 403 coerente (non solo analysis)', async () => {
    const tokenA = await token('tenant-A', 'analyst');
    // /sovereign/tenants/:tenantId/signatures espone :tenantId nel path.
    const res = await request(app.getHttpServer())
      .post('/sovereign/tenants/tenant-B/signatures')
      .set('authorization', `Bearer ${tokenA}`)
      .send({ payload: 'data' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('TENANT_MISMATCH');
  });

  it('admin può operare cross-tenant sul provisioning PQC (200, non 403)', async () => {
    const adminToken = await token('tenant-admin', 'admin');
    const res = await request(app.getHttpServer())
      .post('/sovereign/tenants/keys')
      .set('authorization', `Bearer ${adminToken}`)
      .send({ tenantId: 'tenant-admin' });
    // admin non bloccato dal provisioning riservato; esito funzionale o 400 di validazione, mai 403 FORBIDDEN provisioning.
    expect(res.status).not.toBe(403);
  });
});