/**
 * G5 API seam — epistemic engine (PRD §3.3): pattern corpus, ipotesi
 * autonome, verdetto con meta-learning, causal reasoning, metrics.
 */
import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';

describe('epistemic API (e2e, G5)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('learns patterns, generates hypotheses autonomously and updates on verdicts', async () => {
    for (let i = 0; i < 2; i += 1) {
      const learned = await request(app.getHttpServer())
        .post('/epistemic/patterns')
        .send({ arch: 'x86_64', firstEngineSource: 'ghidra', family: 'updater-ransom' });
      expect(learned.status).toBe(201);
    }

    const gen = await request(app.getHttpServer())
      .post('/epistemic/hypotheses/generate')
      .send({ binaryHash: 'a1b2c3d4e5f60718', arch: 'x86_64', firstEngineSource: 'ghidra' });
    expect(gen.status).toBe(201);
    expect(gen.body.length).toBeGreaterThanOrEqual(1);
    expect(gen.body[0].prediction.family).toBe('updater-ransom');
    expect(gen.body[0].generatedInMs).toBeLessThan(30_000);

    const verdict = await request(app.getHttpServer())
      .post(`/epistemic/hypotheses/${gen.body[0].id}/verdicts`)
      .send({ verdict: 'CONFIRMED' });
    expect(verdict.body.status).toBe('CONFIRMED');

    const metrics = await request(app.getHttpServer()).get('/epistemic/metrics');
    expect(metrics.body.hypotheses).toBeGreaterThanOrEqual(1);
    expect(metrics.body.accuracy).toBeGreaterThan(0);
  });

  it('separates causal relations from mere correlations', async () => {
    await request(app.getHttpServer())
      .post('/epistemic/causal/observations')
      .send({ cause: 'obfuscation-pass', effect: 'cfg-complexity', method: 'differential' });
    await request(app.getHttpServer())
      .post('/epistemic/causal/observations')
      .send({ cause: 'packed-input', effect: 'encrypted-section', method: 'co-occurrence' });

    const causal = await request(app.getHttpServer())
      .get('/epistemic/causal/relation')
      .query({ cause: 'obfuscation-pass', effect: 'cfg-complexity' });
    expect(causal.body.relation).toBe('causal');

    const correlational = await request(app.getHttpServer())
      .get('/epistemic/causal/relation')
      .query({ cause: 'packed-input', effect: 'encrypted-section' });
    expect(correlational.body.relation).toBe('correlational');

    const cf = await request(app.getHttpServer())
      .get('/epistemic/counterfactual')
      .query({ cause: 'packed-input', effect: 'encrypted-section' });
    expect(cf.body.text).toMatch(/Non dimostrabile/);
  });

  it('validates the contract: malformed payloads are 400, unknown ids 404', async () => {
    const bad = await request(app.getHttpServer())
      .post('/epistemic/hypotheses/generate')
      .send({ arch: 'x86_64' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_PAYLOAD');

    const missing = await request(app.getHttpServer())
      .post('/epistemic/hypotheses/hyp-none/verdicts')
      .send({ verdict: 'CONFIRMED' });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('RESULT_NOT_FOUND');
  });
});
