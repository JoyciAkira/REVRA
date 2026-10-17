/**
 * Refutation seam (PRD §3.1 Neural-Symbolic Hybrid): the symbolic engine
 * verifies OR refutes each neural candidate *with proof*. A refutation is a
 * recorded verdict — the result stays visible, flagged, never deleted.
 */
import { describe, expect, it } from 'vitest';
import { EvidenceKernel } from '../src/kernel.js';
import { ACTORS, nextId, submitInput } from './helpers.js';

function kernelWithL1() {
  const kernel = new EvidenceKernel({ idGen: () => nextId('res') });
  const result = kernel.submit(submitInput(), ACTORS.ai);
  return { kernel, result };
}

describe('refute', () => {
  it('flags the candidate without changing its level, recording the proof', () => {
    const { kernel, result } = kernelWithL1();

    const refuted = kernel.refute(result.id, ACTORS.symbolic, {
      evidenceRef: 'smt://counterexample-17',
      reason: 'behavioral test diverged on input set B',
    });

    expect(refuted.verification.state).toBe('L1');
    expect(refuted.verification.warnings).toContain('REFUTED');
    const last = refuted.provenance.at(-1)!;
    expect(last.action).toBe('refute');
    expect(last.evidenceRef).toBe('smt://counterexample-17');
    expect(last.note).toBe('behavioral test diverged on input set B');
  });

  it('rejects AI refutations (verification is not an AI prerogative)', () => {
    const { kernel, result } = kernelWithL1();

    expect(() =>
      kernel.refute(result.id, ACTORS.ai, { evidenceRef: 'x://1', reason: 'no' }),
    ).toThrowError(/AI_AUTHORITY_BOUNDARY/);
  });

  it('rejects refutations without proof', () => {
    const { kernel, result } = kernelWithL1();

    expect(() =>
      kernel.refute(result.id, ACTORS.symbolic, { reason: 'gut feeling' }),
    ).toThrowError(/REFUTE_REQUIRES_EVIDENCE/);
  });

  it('refuses to refute a formally proven result (needs certificate invalidation)', () => {
    const { kernel, result } = kernelWithL1();
    kernel.promote(result.id, 'L2', ACTORS.symbolic, { evidenceRef: 'test://1' });
    kernel.useVerifier({ name: 'v', version: '0', verify: async () => ({ outcome: 'VERIFIED' }) });
    return kernel
      .attachCertificate(
        {
          resultId: result.id,
          theorem: 'semantic-preservation',
          proofTerm: 'theorem t : True := trivial',
          semanticModel: 'lean4-imp-semantics@0.1',
          property: 'p',
          assumptions: [],
          binaryHash: result.binaryHash,
          instructionRange: result.addressRange,
          arch: result.arch,
        },
        ACTORS.system,
      )
      .then(() => {
        expect(() =>
          kernel.refute(result.id, ACTORS.symbolic, { evidenceRef: 'x://2', reason: 'no' }),
        ).toThrowError(/INVALID_TRANSITION/);
      });
  });
});
