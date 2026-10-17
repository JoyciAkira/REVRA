/**
 * F0.1 API seam — persistenza: due app sullo stesso file SQLite condividono
 * l'universo di evidenza. kill&restart preserva risultati e certificati
 * (accettazione F0: "restart preserva tutto").
 */
import 'reflect-metadata';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';

const DB_PATH = join(mkdtempSync(join(tmpdir(), 'revra-f01-')), 'state.db');
const SUBMIT_BODY = {
  actor: { kind: 'ai', id: 'neural-proposer' },
  result: {
    binaryHash: 'a1b2c3d4e5f60718',
    arch: 'x86_64',
    addressRange: { start: '0x401000', end: '0x4010ff' },
    engineSource: 'ghidra',
    claim: { kind: 'decompilation', payload: { pseudocode: 'int persist() { return 1; }' } },
  },
};

async function bootApp(): Promise<INestApplication> {
  process.env.REVRA_DB = DB_PATH;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

describe('persistence (e2e, F0.1)', () => {
  let appA: INestApplication;
  let resultId: string;

  it('boot A: submit + promote, poi shutdown con salvataggio', async () => {
    appA = await bootApp();
    const created = await request(appA.getHttpServer()).post('/analysis/results').send(SUBMIT_BODY);
    expect(created.status).toBe(201);
    resultId = created.body.id;

    const promoted = await request(appA.getHttpServer())
      .post(`/analysis/results/${resultId}/promotions`)
      .send({ to: 'L2', actor: { kind: 'symbolic', id: 'type-inference-engine' }, evidence: { evidenceRef: 'test://f0-1' } });
    expect(promoted.status).toBe(200);
    await appA.close();
  });

  it('boot B: lo stesso DB restituisce lo stato sopravvissuto', async () => {
    const appB = await bootApp();
    const restored = await request(appB.getHttpServer()).get(`/analysis/results/${resultId}`);

    expect(restored.status).toBe(200);
    expect(restored.body.verification.state).toBe('L2');
    expect(restored.body.provenance).toHaveLength(2);

    const coverage = await request(appB.getHttpServer()).get('/analysis/coverage');
    expect(coverage.body.eligibilityCoverage.total).toBe(1);
    await appB.close();
  });

  it('boot C: le ipotesi epistemiche sopravvivono al riavvio (F0.3)', async () => {
    const appC = await bootApp();
    await request(appC.getHttpServer())
      .post('/epistemic/patterns')
      .send({ arch: 'x86_64', firstEngineSource: 'ghidra', family: 'updater-ransom' });
    const gen = await request(appC.getHttpServer())
      .post('/epistemic/hypotheses/generate')
      .send({ binaryHash: 'a1b2c3d4e5f60718', arch: 'x86_64', firstEngineSource: 'ghidra' });
    expect(gen.status).toBe(201);
    await appC.close();

    const appD = await bootApp();
    const hypotheses = await request(appD.getHttpServer()).get('/epistemic/hypotheses');
    expect(hypotheses.body.length).toBeGreaterThanOrEqual(1);
    expect(hypotheses.body[0].prediction.family).toBe('updater-ransom');
    await appD.close();
  });

  afterAll(() => {
    delete process.env.REVRA_DB;
  });
});
