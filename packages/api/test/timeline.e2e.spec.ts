/**
 * G4 API seam — temporal navigation (PRD §3.2): timeline snapshots, causal
 * chain, branching verso universi paralleli e merge a convergenza.
 */
import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EvidenceKernel } from '@revra/kernel';
import { AppModule } from '../src/app.module.js';
import { EVIDENCE_KERNEL } from '../src/tokens.js';

const AI = { kind: 'ai', id: 'neural-proposer' };
const SYMBOLIC = { kind: 'symbolic', id: 'type-inference-engine' };

async function seedResult(app: INestApplication): Promise<string> {
  const created = await request(app.getHttpServer())
    .post('/analysis/results')
    .send({
      actor: AI,
      result: {
        binaryHash: 'a1b2c3d4e5f60718',
        arch: 'x86_64',
        addressRange: { start: '0x401000', end: '0x4010ff' },
        engineSource: 'ghidra',
        claim: { kind: 'decompilation', payload: { pseudocode: 'int f() { return 4; }' } },
      },
    });
  return created.body.id as string;
}

describe('timeline API (e2e, G4)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EVIDENCE_KERNEL)
      .useFactory({ factory: () => new EvidenceKernel() })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves snapshots and the causal chain of a result', async () => {
    const resultId = await seedResult(app);
    await request(app.getHttpServer())
      .post(`/analysis/results/${resultId}/promotions`)
      .send({ to: 'L2', actor: SYMBOLIC, evidence: { evidenceRef: 'test://re-9' } });

    const tl = await request(app.getHttpServer()).get(`/timeline/results/${resultId}`);

    expect(tl.status).toBe(200);
    expect(tl.body.snapshots.map((s: { state: string }) => s.state)).toEqual(['L1', 'L2']);
    expect(tl.body.causalChain).toHaveLength(2);
    expect(tl.body.causalChain[1].becauseEvidence).toBe('test://re-9');
    expect(tl.body.causalChain[1].causedBy).toBe(tl.body.causalChain[0].eventId);
  });

  it('branches a parallel universe and merges converging branches', async () => {
    const resultId = await seedResult(app);

    const branchA = await request(app.getHttpServer())
      .post('/timeline/branches')
      .send({ resultId, label: 'universe-A' });
    const branchB = await request(app.getHttpServer())
      .post('/timeline/branches')
      .send({ resultId, label: 'universe-B' });

    expect(branchA.status).toBe(201);
    expect(branchA.body.branchedResultId).not.toBe(resultId);

    const list = await request(app.getHttpServer()).get('/timeline/branches');
    expect(list.body).toHaveLength(2);

    const merge = await request(app.getHttpServer())
      .post('/timeline/merge')
      .send({ branchIdA: branchA.body.branchId, branchIdB: branchB.body.branchId });

    expect(merge.status).toBe(201);
    expect(merge.body.outcome).toBe('UNIFIED');
    expect(merge.body.unifiedResultId).toBeTruthy();
  });

  it('answers 409 with the contract code for incompatible merges', async () => {
    const a = await request(app.getHttpServer())
      .post('/analysis/results')
      .send({
        actor: AI,
        result: {
          binaryHash: 'a1b2c3d4e5f60718',
          arch: 'x86_64',
          addressRange: { start: '0x501000', end: '0x5010ff' },
          engineSource: 'ghidra',
          claim: { kind: 'decompilation', payload: { pseudocode: 'int q() { return 1; }' } },
        },
      });
    const branch = await request(app.getHttpServer())
      .post('/timeline/branches')
      .send({ resultId: a.body.id, label: 'far-away' });
    const other = await request(app.getHttpServer())
      .post('/timeline/branches')
      .send({ resultId: a.body.id, label: 'second' });

    const merge = await request(app.getHttpServer())
      .post('/timeline/merge')
      .send({ branchIdA: branch.body.branchId, branchIdB: other.body.branchId });

    // Stesso punto di origine → claim identici → unifica (deterministico).
    expect(merge.body.outcome).toBe('UNIFIED');

    const missing = await request(app.getHttpServer())
      .post('/timeline/merge')
      .send({ branchIdA: 'branch-none', branchIdB: branch.body.branchId });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('RESULT_NOT_FOUND');
  });
});
