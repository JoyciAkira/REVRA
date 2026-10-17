/**
 * F2 API seam — il primo L3 VERO via HTTP: result L1 → promozione L2 →
 * attachCertificate con proofTerm Lean verificato dal toolchain → L3.
 * Proof rotto → PROOF_FAILED → degradazione esplicita (mai L3 finto).
 * Richiede la toolchain lean installata; altrimenti l'intera suite skip.
 */
import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Lean4CliVerifier } from '@revra/kernel';
import { AppModule } from '../src/app.module.js';
import { EVIDENCE_KERNEL } from '../src/tokens.js';

const AI = { kind: 'ai', id: 'neural-proposer' };
const SYMBOLIC = { kind: 'symbolic', id: 'structural' };
const SYSTEM = { kind: 'system', id: 'revra-kernel' };

const leanInstalled = await Lean4CliVerifier.detect() !== undefined;

function submitBody(proofContext: 'ok' | 'broken') {
  return {
    actor: AI,
    result: {
      binaryHash: proofContext === 'ok' ? 'a1b2c3d4e5f60718' : 'b2c3d4e5f60719',
      arch: 'x86_64',
      addressRange: { start: '0x401000', end: '0x4010ff' },
      engineSource: 'ghidra',
      claim: { kind: 'decompilation', payload: { pseudocode: 'int f() { return 1; }' } },
    },
  };
}

function certificate(proofTerm: string) {
  return {
    theorem: 'semantic-preservation',
    proofTerm,
    semanticModel: 'lean4-core',
    property: 'p',
    assumptions: [],
    binaryHash: 'a1b2c3d4e5f60718',
    instructionRange: { start: '0x401000', end: '0x4010ff' },
    arch: 'x86_64',
  };
}

describe.skipIf(!leanInstalled)('L3 via Lean reale (e2e, F2)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  async function seedAndPromote(binaryHash: string, token?: string): Promise<string> {
    const created = await request(app.getHttpServer())
      .post('/analysis/results')
      .set(token ? { authorization: `Bearer ${token}` } : {})
      .send({
        actor: AI,
        result: {
          binaryHash,
          arch: 'x86_64',
          addressRange: { start: '0x401000', end: '0x4010ff' },
          engineSource: 'ghidra',
          claim: { kind: 'decompilation', payload: { pseudocode: 'int f() { return 1; }' } },
        },
      });
    expect(created.status).toBe(201);
    const promoted = await request(app.getHttpServer())
      .post(`/analysis/results/${created.body.id}/promotions`)
      .send({ to: 'L2', actor: SYMBOLIC, evidence: { evidenceRef: 'structural://1' } });
    expect(promoted.status).toBe(200);
    return created.body.id;
  }

  it('L1 → L2 → L3 con certificato Lean verificato dal toolchain', async () => {
    const resultId = await seedAndPromote('a1b2c3d4e5f60718');

    const proven = await request(app.getHttpServer())
      .post(`/analysis/results/${resultId}/certificates`)
      .send({
        actor: SYSTEM,
        certificate: {
          theorem: 'true-is-true',
          proofTerm: 'theorem revra_ok : True := trivial',
          semanticModel: 'lean4-core',
          property: 'True',
          assumptions: [],
          binaryHash: 'a1b2c3d4e5f60718',
          instructionRange: { start: '0x401000', end: '0x4010ff' },
          arch: 'x86_64',
        },
      });

    expect(proven.status).toBe(200);
    expect(proven.body.result.verification.state).toBe('L3');
    expect(proven.body.certificate.outcome).toBe('VERIFIED');
    expect(proven.body.certificate.verifier.name).toBe('lean4');
  });

  it('proof rotto → PROOF_FAILED → il risultato resta L1 con warning (mai L3 finto)', async () => {
    const created = await request(app.getHttpServer())
      .post('/analysis/results')
      .send(submitBody('broken'));
    const resultId = created.body.id;

    const failed = await request(app.getHttpServer())
      .post(`/analysis/results/${resultId}/certificates`)
      .send({
        actor: SYSTEM,
        certificate: {
          theorem: 'false-from-trivial',
          proofTerm: 'theorem revra_bad : False := trivial',
          semanticModel: 'lean4-core',
          property: 'False',
          assumptions: [],
          binaryHash: 'b2c3d4e5f60719',
          instructionRange: { start: '0x401000', end: '0x4010ff' },
          arch: 'x86_64',
        },
      });

    expect(failed.status).toBe(200);
    expect(failed.body.result.verification.state).toBe('L1');
    expect(failed.body.result.verification.warnings).toContain('PROOF_FAILED');
    expect(failed.body.certificate.outcome).toBe('PROOF_FAILED');
  });
});
