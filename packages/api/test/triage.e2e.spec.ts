/**
 * M1 API seam — triage aggregato: un binario → tutta la conoscenza
 * (risultati kernel + ipotesi epistemiche) con conteggi.
 */
import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';

const HASH = 'a1b2c3d4e5f60718';
const AI = { kind: 'ai', id: 'neural-proposer' };

function submitBody(pseudocode: string) {
  return {
    actor: AI,
    result: {
      binaryHash: HASH,
      arch: 'x86_64',
      addressRange: { start: '0x401000', end: '0x4010ff' },
      engineSource: 'ghidra',
      claim: { kind: 'decompilation', payload: { pseudocode } },
    },
  };
}

describe('triage API (e2e, M1)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    // Seed: due risultati dello stesso binario + un pattern per le ipotesi.
    await request(app.getHttpServer()).post('/analysis/results').send(submitBody('int f() { return 1; }'));
    await request(app.getHttpServer()).post('/analysis/results').send(submitBody('int f() { return 2; }'));
    await request(app.getHttpServer())
      .post('/epistemic/patterns')
      .send({ arch: 'x86_64', firstEngineSource: 'ghidra', family: 'updater-ransom' });
    await request(app.getHttpServer())
      .post('/epistemic/hypotheses/generate')
      .send({ binaryHash: HASH, arch: 'x86_64', firstEngineSource: 'ghidra' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('aggregates results and hypotheses for one binary', async () => {
    const summary = await request(app.getHttpServer()).get(`/triage/${HASH}`);

    expect(summary.status).toBe(200);
    expect(summary.body.binaryHash).toBe(HASH);
    expect(summary.body.results).toHaveLength(2);
    expect(summary.body.counts.results).toBe(2);
    expect(summary.body.hypotheses.length).toBeGreaterThanOrEqual(1);
    expect(summary.body.counts.proposed).toBeGreaterThanOrEqual(1);
  });

  it('returns empty summary for an unknown binary', async () => {
    const empty = await request(app.getHttpServer()).get('/triage/0000000000000000');
    expect(empty.status).toBe(200);
    expect(empty.body.counts.results).toBe(0);
    expect(empty.body.results).toHaveLength(0);
  });
});
