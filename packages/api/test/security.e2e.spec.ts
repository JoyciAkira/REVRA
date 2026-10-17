/**
 * F0.2 API seam — secure mode (REVRA_JWT_SECRET attivo): auth obbligatoria,
 * ruoli RBAC, isolamento tenant (403 TENANT_MISMATCH) e audit trail.
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

process.env.REVRA_JWT_SECRET = 'test-secret-f0-2';
process.env.REVRA_DB = join(mkdtempSync(join(tmpdir(), 'revra-f02-')), 'state.db');

const SUBMIT_BODY = {
  actor: { kind: 'ai', id: 'neural-proposer' },
  result: {
    binaryHash: 'a1b2c3d4e5f60718',
    arch: 'x86_64',
    addressRange: { start: '0x401000', end: '0x4010ff' },
    engineSource: 'ghidra',
    claim: { kind: 'decompilation', payload: { pseudocode: 'int f() { return 1; }' } },
  },
};

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
    jwt: app.get(JwtAuthService, { strict: false }),
    audit: app.get(AuditService, { strict: false }),
    metrics: new MetricsRegistry(),
  });
  await app.init();
});

afterAll(async () => {
  await app.close();
  delete process.env.REVRA_JWT_SECRET;
  delete process.env.REVRA_DB;
});

describe('security (e2e, F0.2)', () => {
  it('blocks unauthenticated access and issues tokens on /auth/token', async () => {
    const blocked = await request(app.getHttpServer()).get('/analysis/results');
    expect(blocked.status).toBe(401);
    expect(blocked.body.error.code).toBe('UNAUTHORIZED');

    const issued = await request(app.getHttpServer())
      .post('/auth/token')
      .send({ tenantId: 'tenant-alpha', role: 'analyst' });
    expect(issued.status).toBe(200);
    expect(issued.body.token.split('.')).toHaveLength(3);
  });

  it('rejects tampered tokens', async () => {
    const issued = await request(app.getHttpServer())
      .post('/auth/token')
      .send({ tenantId: 'tenant-alpha', role: 'analyst' });
    const tampered = `${issued.body.token.slice(0, -2)}xx`;

    const response = await request(app.getHttpServer())
      .get('/analysis/results')
      .set('authorization', `Bearer ${tampered}`);
    expect(response.status).toBe(401);
  });

  it('isolates tenants: alpha non vede i risultati di beta', async () => {
    const alphaToken = await token('tenant-alpha', 'analyst');
    const betaToken = await token('tenant-beta', 'analyst');

    const created = await request(app.getHttpServer())
      .post('/analysis/results')
      .set('authorization', `Bearer ${alphaToken}`)
      .send(SUBMIT_BODY);
    expect(created.status).toBe(201);
    expect(created.body.tenantId).toBe('tenant-alpha');

    const alphaList = await request(app.getHttpServer())
      .get('/analysis/results')
      .set('authorization', `Bearer ${alphaToken}`);
    expect(alphaList.body).toHaveLength(1);

    const betaList = await request(app.getHttpServer())
      .get('/analysis/results')
      .set('authorization', `Bearer ${betaToken}`);
    expect(betaList.body).toHaveLength(0);

    const crossTenant = await request(app.getHttpServer())
      .get(`/analysis/results/${created.body.id}`)
      .set('authorization', `Bearer ${betaToken}`);
    expect(crossTenant.status).toBe(403);
    expect(crossTenant.body.error.code).toBe('TENANT_MISMATCH');

    const crossPromote = await request(app.getHttpServer())
      .post(`/analysis/results/${created.body.id}/promotions`)
      .set('authorization', `Bearer ${betaToken}`)
      .send({ to: 'L2', actor: { kind: 'symbolic', id: 'x' }, evidence: { evidenceRef: 'x://1' } });
    expect(crossPromote.status).toBe(403);
    expect(crossPromote.body.error.code).toBe('TENANT_MISMATCH');
  });

  it('enforces RBAC: viewer is read-only', async () => {
    const viewerToken = await token('tenant-alpha', 'viewer');

    const blocked = await request(app.getHttpServer())
      .post('/analysis/results')
      .set('authorization', `Bearer ${viewerToken}`)
      .send(SUBMIT_BODY);
    expect(blocked.status).toBe(403);

    const allowedRead = await request(app.getHttpServer())
      .get('/analysis/results')
      .set('authorization', `Bearer ${viewerToken}`);
    expect(allowedRead.status).toBe(200);
  });

  it('writes the audit trail for mutations', async () => {
    const adminToken = await token('tenant-alpha', 'admin');
    const entries = await request(app.getHttpServer())
      .get('/audit/entries')
      .set('authorization', `Bearer ${adminToken}`);
    expect(entries.status).toBe(200);
    const paths = entries.body.map((e: { path: string }) => e.path);
    expect(paths).toContain('/analysis/results');
    const egress = entries.body.find((e: { path: string }) => e.path === '/analysis/results');
    expect(egress.tenantId).toBeTruthy();
  });
});
