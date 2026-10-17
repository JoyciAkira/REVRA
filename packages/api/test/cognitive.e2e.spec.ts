/**
 * G3 API seam — cognitive telemetry (PRD §3.2): derived states only, BCI
 * registry, aggregate metrics. Raw signals never appear in the contract.
 */
import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';

function derivedState(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'sess-e2e',
    loadLevel: 0.85,
    flowScore: 0.2,
    source: 'keyboard-mouse',
    adaptationApplied: 'SIMPLIFY',
    ...overrides,
  };
}

describe('cognitive API (e2e, G3)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('records derived states and refuses payloads outside the contract', async () => {
    const ok = await request(app.getHttpServer())
      .post('/cognitive/states')
      .send(derivedState());
    expect(ok.status).toBe(201);
    expect(ok.body.ts).toBeTruthy();

    const bad = await request(app.getHttpServer())
      .post('/cognitive/states')
      .send(derivedState({ loadLevel: 4.2 }));
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_PAYLOAD');
  });

  it('serves per-session history and aggregate metrics', async () => {
    await request(app.getHttpServer())
      .post('/cognitive/states')
      .send(derivedState({ loadLevel: 0.2, flowScore: 0.9, adaptationApplied: 'EXPAND' }));

    const history = await request(app.getHttpServer()).get('/cognitive/states/sess-e2e');
    expect(history.body).toHaveLength(2);

    const metrics = await request(app.getHttpServer()).get('/cognitive/metrics');
    expect(metrics.body.sessions).toBe(1);
    expect(metrics.body.states).toBe(2);
    expect(metrics.body.adaptations).toEqual({ SIMPLIFY: 1, EXPAND: 1, STABLE: 0 });
  });

  it('registers BCI adapters and lists them', async () => {
    const reg = await request(app.getHttpServer())
      .post('/cognitive/bci/adapters')
      .send({ adapterId: 'neuro-puck-1', vendor: 'OpenBCI', modalities: ['EEG'], sampleRateHz: 250 });
    expect(reg.status).toBe(201);
    expect(reg.body.registration.adapterId).toBe('neuro-puck-1');

    const list = await request(app.getHttpServer()).get('/cognitive/bci/adapters');
    expect(list.body).toHaveLength(1);
  });
});
