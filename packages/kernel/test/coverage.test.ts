/**
 * Coverage seam — Dual Coverage Metrics (PRD §0.3). Expected values are worked
 * examples computed by hand from the fixture, not by re-running the code.
 */
import { describe, expect, it } from 'vitest';
import { EvidenceKernel } from '../src/kernel.js';
import { ACTORS, MockVerifier, nextId, submitInput } from './helpers.js';

/**
 * Fixture (5 results, claim kinds in parentheses):
 *   r1 decompilation → L3 via VERIFIED certificate  → eligible, proven
 *   r2 decompilation → L2                           → eligible, not proven
 *   r3 decompilation → L1                           → eligible, not proven
 *   r4 symbol       → L1                            → NOT eligible (kind)
 *   r5 decompilation → UNSUPPORTED                   → NOT eligible (state)
 * Proof Coverage = 1/3 · Eligibility Coverage = 3/5
 */
async function coverageFixture() {
  const kernel = new EvidenceKernel({ idGen: () => nextId('res') });

  const r1 = kernel.submit(submitInput(), ACTORS.ai);
  const r2 = kernel.submit(submitInput(), ACTORS.ai);
  const r3 = kernel.submit(submitInput(), ACTORS.ai);
  kernel.submit(submitInput({ claim: { kind: 'symbol', payload: { name: 'f' } } }), ACTORS.engine);
  const r5 = kernel.submit(submitInput(), ACTORS.ai);

  kernel.promote(r1.id, 'L2', ACTORS.symbolic, { evidenceRef: 'test://1' });
  kernel.promote(r2.id, 'L2', ACTORS.symbolic, { evidenceRef: 'test://2' });
  kernel.useVerifier(new MockVerifier('VERIFIED'));
  await kernel.attachCertificate(
    {
      resultId: r1.id,
      theorem: 'semantic-preservation',
      proofTerm: 'theorem t : True := trivial',
      semanticModel: 'lean4-imp-semantics@0.1',
      property: 'p',
      assumptions: [],
      binaryHash: r1.binaryHash,
      instructionRange: r1.addressRange,
      arch: r1.arch,
    },
    ACTORS.system,
  );
  kernel.markUnsupported(r5.id, ACTORS.system, 'property not expressible in current model');

  return { kernel, r1 };
}

describe('coverage', () => {
  it('reports proof coverage over eligible claims only', async () => {
    const { kernel } = await coverageFixture();

    const report = kernel.coverage();

    expect(report.proofCoverage.proven).toBe(1);
    expect(report.proofCoverage.eligible).toBe(3);
    expect(report.proofCoverage.value).toBeCloseTo(1 / 3);
  });

  it('reports eligibility coverage so a small eligible set stays visible', async () => {
    const { kernel } = await coverageFixture();

    const report = kernel.coverage();

    expect(report.eligibilityCoverage.eligible).toBe(3);
    expect(report.eligibilityCoverage.total).toBe(5);
    expect(report.eligibilityCoverage.value).toBeCloseTo(3 / 5);
  });

  it('returns null values instead of NaN on an empty corpus', () => {
    const kernel = new EvidenceKernel();

    const report = kernel.coverage();

    expect(report.proofCoverage.value).toBeNull();
    expect(report.eligibilityCoverage.value).toBeNull();
  });
});
