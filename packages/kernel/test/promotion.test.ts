/**
 * Promotion seam: No Silent Promotion and AI Authority Boundary (PRD §0.2).
 * L1 → L2 needs explicit tracked evidence; L3 needs a VERIFIED certificate;
 * AI actors can never promote their own output.
 */
import { describe, expect, it } from 'vitest';
import { EvidenceKernel } from '../src/kernel.js';
import { ACTORS, MockVerifier, nextId, submitInput } from './helpers.js';

function kernelWithL1() {
  const kernel = new EvidenceKernel({ idGen: () => nextId('res') });
  const result = kernel.submit(submitInput(), ACTORS.ai);
  return { kernel, result };
}

describe('promote', () => {
  it('rejects AI promoting its own L1 output to L2', () => {
    const { kernel, result } = kernelWithL1();

    expect(() =>
      kernel.promote(result.id, 'L2', ACTORS.ai, { evidenceRef: 'doc://retest-1' }),
    ).toThrowError(/AI_AUTHORITY_BOUNDARY/);
  });

  it('rejects promotion without an evidence reference (No Silent Promotion)', () => {
    const { kernel, result } = kernelWithL1();

    expect(() =>
      kernel.promote(result.id, 'L2', ACTORS.symbolic, {}),
    ).toThrowError(/NO_SILENT_PROMOTION/);
  });

  it('promotes L1 → L2 with a symbolic verifier and tracked evidence', () => {
    const { kernel, result } = kernelWithL1();

    const promoted = kernel.promote(result.id, 'L2', ACTORS.symbolic, {
      evidenceRef: 'test://re-execution-suite-42',
    });

    expect(promoted.verification.state).toBe('L2');
    const last = promoted.provenance.at(-1)!;
    expect(last.action).toBe('promote');
    expect(last.fromState).toBe('L1');
    expect(last.toState).toBe('L2');
    expect(last.evidenceRef).toBe('test://re-execution-suite-42');
  });

  it('rejects skipping levels (L1 → L3 directly)', () => {
    const { kernel, result } = kernelWithL1();

    expect(() =>
      kernel.promote(result.id, 'L3', ACTORS.system, { evidenceRef: 'x://1' }),
    ).toThrowError(/INVALID_TRANSITION/);
  });

  it('rejects L2 → L3 without a VERIFIED certificate', () => {
    const { kernel, result } = kernelWithL1();
    kernel.promote(result.id, 'L2', ACTORS.symbolic, { evidenceRef: 'test://1' });

    expect(() =>
      kernel.promote(result.id, 'L3', ACTORS.system, { evidenceRef: 'test://2' }),
    ).toThrowError(/L3_REQUIRES_VERIFIED_CERTIFICATE/);
  });

  it('rejects demotion attempts through promote (use degrade instead)', () => {
    const { kernel, result } = kernelWithL1();

    expect(() =>
      kernel.promote(result.id, 'L1', ACTORS.analyst, { evidenceRef: 'x://1' }),
    ).toThrowError(/INVALID_TRANSITION/);
  });

  it('rejects promotion of an unknown result', () => {
    const kernel = new EvidenceKernel({ idGen: () => nextId('res') });

    expect(() =>
      kernel.promote('missing', 'L2', ACTORS.symbolic, { evidenceRef: 'x://1' }),
    ).toThrowError(/RESULT_NOT_FOUND/);
  });
});

describe('attachCertificate', () => {
  it('promotes to L3 only when the verifier returns VERIFIED', async () => {
    const { kernel, result } = kernelWithL1();
    kernel.promote(result.id, 'L2', ACTORS.symbolic, { evidenceRef: 'test://1' });
    const verifier = new MockVerifier('VERIFIED');
    kernel.useVerifier(verifier);

    const { result: proven } = await kernel.attachCertificate(
      {
        resultId: result.id,
        theorem: 'semantic-preservation',
        proofTerm: 'theorem t : True := trivial',
        semanticModel: 'lean4-imp-semantics@0.1',
        property: 'output-equals-source-semantics',
        assumptions: [],
        binaryHash: result.binaryHash,
        instructionRange: result.addressRange,
        arch: result.arch,
      },
      ACTORS.system,
    );

    expect(verifier.calls).toEqual(['semantic-preservation']);
    expect(proven.verification.state).toBe('L3');
    expect(kernel.getCertificate(result.id)?.outcome).toBe('VERIFIED');
  });
});
