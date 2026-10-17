/**
 * API seam — acceptance slice of PRD §6.1: results carry explicit evidence
 * labels, contract violations answer 409 with the rule code, L3 requires a
 * verified certificate, reconciliation keeps conflicts visible, coverage is
 * reported (dual metrics §0.3).
 */
import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor, SubmitResultInput } from '@revra/contracts';
import { EvidenceKernel } from '@revra/kernel';
import type { ProofVerifier, VerifierRun } from '@revra/kernel';
import { AppModule } from '../src/app.module.js';
import { EVIDENCE_KERNEL } from '../src/tokens.js';

const AI: Actor = { kind: 'ai', id: 'neural-proposer' };
const SYMBOLIC: Actor = { kind: 'symbolic', id: 'type-inference-engine' };
const SYSTEM: Actor = { kind: 'system', id: 'revra-kernel' };

class ScriptedVerifier implements ProofVerifier {
  readonly name = 'scripted';
  readonly version = '0.0.0';
  constructor(readonly outcome: VerifierRun['outcome']) {}
  async verify(): Promise<VerifierRun> {
    return { outcome: this.outcome };
  }
}

function submitBody(overrides: Partial<SubmitResultInput> = {}, actor: Actor = AI) {
  return {
    actor,
    result: {
      binaryHash: 'a1b2c3d4e5f60718',
      arch: 'x86_64',
      addressRange: { start: '0x401000', end: '0x4010ff' },
      engineSource: 'ghidra',
      claim: { kind: 'decompilation', payload: { pseudocode: 'int f() { return 1; }' } },
      ...overrides,
    },
  };
}

describe('analysis API (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EVIDENCE_KERNEL)
      .useFactory({
        factory: () => {
          const kernel = new EvidenceKernel();
          kernel.useVerifier(new ScriptedVerifier('VERIFIED'));
          return kernel;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('walks submit → rejected promotions → promotion → certificate → L3', async () => {
    const created = await request(app.getHttpServer())
      .post('/analysis/results')
      .send(submitBody());
    expect(created.status).toBe(201);
    const resultId = created.body.id as string;
    expect(created.body.verification.state).toBe('L1');

    const aiPromotion = await request(app.getHttpServer())
      .post(`/analysis/results/${resultId}/promotions`)
      .send({ to: 'L2', actor: AI, evidence: { evidenceRef: 'x://1' } });
    expect(aiPromotion.status).toBe(409);
    expect(aiPromotion.body.error.code).toBe('AI_AUTHORITY_BOUNDARY');

    const silentPromotion = await request(app.getHttpServer())
      .post(`/analysis/results/${resultId}/promotions`)
      .send({ to: 'L2', actor: SYMBOLIC, evidence: {} });
    expect(silentPromotion.status).toBe(409);
    expect(silentPromotion.body.error.code).toBe('NO_SILENT_PROMOTION');

    const promoted = await request(app.getHttpServer())
      .post(`/analysis/results/${resultId}/promotions`)
      .send({ to: 'L2', actor: SYMBOLIC, evidence: { evidenceRef: 'test://suite-42' } });
    expect(promoted.status).toBe(200);
    expect(promoted.body.verification.state).toBe('L2');

    const proven = await request(app.getHttpServer())
      .post(`/analysis/results/${resultId}/certificates`)
      .send({
        actor: SYSTEM,
        certificate: {
          theorem: 'semantic-preservation',
          proofTerm: 'theorem t : True := trivial',
          semanticModel: 'lean4-imp-semantics@0.1',
          property: 'p',
          assumptions: [],
          binaryHash: 'a1b2c3d4e5f60718',
          instructionRange: { start: '0x401000', end: '0x4010ff' },
          arch: 'x86_64',
        },
      });
    expect(proven.status).toBe(200);
    expect(proven.body.result.verification.state).toBe('L3');
    expect(proven.body.certificate.outcome).toBe('VERIFIED');
  });

  it('surfaces cross-engine disagreement as DISPUTED with a counterexample request', async () => {
    const a = await request(app.getHttpServer()).post('/analysis/results').send(submitBody());
    const b = await request(app.getHttpServer())
      .post('/analysis/results')
      .send(
        submitBody({
          engineSource: 'radare2',
          claim: { kind: 'decompilation', payload: { pseudocode: 'int f() { return 2; }' } },
        }),
      );

    const report = await request(app.getHttpServer())
      .post('/analysis/reconciliations')
      .send({ resultIdA: a.body.id, resultIdB: b.body.id });

    expect(report.status).toBe(201);
    expect(report.body.outcome).toBe('DISPUTED');
    expect(report.body.counterexampleRequested).toBe(true);
    expect(report.body.disputedSides).toHaveLength(2);

    const conflicted = await request(app.getHttpServer()).get(`/analysis/results/${a.body.id}`);
    expect(conflicted.body.verification.state).toBe('DISPUTED');
  });

  it('reports dual coverage and the full provenance chain', async () => {
    const coverage = await request(app.getHttpServer()).get('/analysis/coverage');
    expect(coverage.status).toBe(200);
    expect(coverage.body.proofCoverage.proven).toBe(1);
    expect(coverage.body.eligibilityCoverage.total).toBe(3);

    const [first] = (await request(app.getHttpServer()).get('/analysis/results')).body;
    const provenance = await request(app.getHttpServer()).get(
      `/analysis/results/${first.id}/provenance`,
    );
    expect(provenance.status).toBe(200);
    expect(provenance.body[0].action).toBe('submit');
  });

  it('answers 404 with the contract code for unknown results', async () => {
    const missing = await request(app.getHttpServer()).get('/analysis/results/missing');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('RESULT_NOT_FOUND');
  });
});
