/**
 * Degradation seam — Graceful Degradation (PRD §0.2): when formal verification
 * fails or times out, the result is kept at L1/L2 with an explicit warning.
 * Results are never discarded and never silently promoted.
 */
import { describe, expect, it } from 'vitest';
import { EvidenceKernel } from '../src/kernel.js';
import { ACTORS, MockVerifier, nextId, submitInput } from './helpers.js';

async function kernelAtL2(outcome: 'PROOF_FAILED' | 'VERIFICATION_TIMEOUT' | 'VERIFIER_UNAVAILABLE') {
  const kernel = new EvidenceKernel({ idGen: () => nextId('res') });
  const result = kernel.submit(submitInput(), ACTORS.ai);
  kernel.promote(result.id, 'L2', ACTORS.symbolic, { evidenceRef: 'test://1' });
  kernel.useVerifier(new MockVerifier(outcome));
  return { kernel, result };
}

function certificateInputFor(result: { id: string; binaryHash: string; arch: string; addressRange: { start: string; end: string } }) {
  return {
    resultId: result.id,
    theorem: 'semantic-preservation',
    proofTerm: 'theorem t : True := trivial',
    semanticModel: 'lean4-imp-semantics@0.1',
    property: 'output-equals-source-semantics',
    assumptions: [],
    binaryHash: result.binaryHash,
    instructionRange: result.addressRange,
    arch: result.arch,
  };
}

describe.each([
  ['PROOF_FAILED'],
  ['VERIFICATION_TIMEOUT'],
  ['VERIFIER_UNAVAILABLE'],
] as const)('verification outcome %s', (outcome) => {
  it(`keeps the result at L1 with an explicit ${outcome} warning`, async () => {
    const { kernel, result } = await kernelAtL2(outcome);

    const { result: degraded } = await kernel.attachCertificate(
      certificateInputFor(result),
      ACTORS.system,
    );

    expect(degraded.verification.state).toBe('L1');
    expect(degraded.verification.warnings).toContain(outcome);
  });

  it('never deletes the result and records the degradation in provenance', async () => {
    const { kernel, result } = await kernelAtL2(outcome);

    const { result: degraded } = await kernel.attachCertificate(
      certificateInputFor(result),
      ACTORS.system,
    );

    expect(kernel.getResult(result.id)).toBeDefined();
    const last = degraded.provenance.at(-1)!;
    expect(last.action).toBe('degrade');
    expect(last.fromState).toBe('L2');
    expect(last.toState).toBe('L1');
    expect(last.note).toContain(outcome);
  });

  it('stores no certificate unless verification actually ran', async () => {
    const { kernel, result } = await kernelAtL2(outcome);

    await kernel.attachCertificate(certificateInputFor(result), ACTORS.system);

    if (outcome === 'VERIFIER_UNAVAILABLE') {
      expect(kernel.getCertificate(result.id)).toBeUndefined();
    } else {
      expect(kernel.getCertificate(result.id)?.outcome).toBe(outcome);
    }
  });
});

describe('attachCertificate bound guarantees', () => {
  it('rejects a certificate whose binary hash does not match the result', async () => {
    const { kernel, result } = await kernelAtL2('VERIFIED');

    const input = {
      ...certificateInputFor(result),
      binaryHash: 'ffffffffffffffff',
    };

    await expect(kernel.attachCertificate(input, ACTORS.system)).rejects.toThrowError(
      /CERTIFICATE_MISMATCH/,
    );
  });
});

describe('degrade', () => {
  it('downgrades L2 → L1 with a warning and keeps full provenance', () => {
    const kernel = new EvidenceKernel({ idGen: () => nextId('res') });
    const result = kernel.submit(submitInput(), ACTORS.ai);
    kernel.promote(result.id, 'L2', ACTORS.symbolic, { evidenceRef: 'test://1' });

    const degraded = kernel.degrade(result.id, 'VERIFICATION_TIMEOUT', ACTORS.system);

    expect(degraded.verification.state).toBe('L1');
    expect(degraded.verification.warnings).toContain('VERIFICATION_TIMEOUT');
  });

  it('refuses to degrade below L0', () => {
    const kernel = new EvidenceKernel({ idGen: () => nextId('res') });
    const result = kernel.submit(
      submitInput({ claim: { kind: 'observed-bytes', payload: {} } }),
      ACTORS.engine,
    );

    expect(() => kernel.degrade(result.id, 'PROOF_FAILED', ACTORS.system)).toThrowError(
      /INVALID_TRANSITION/,
    );
  });
});
