/**
 * Submission seam: every result enters the kernel with an explicit evidence
 * label already attached (PRD §0.1 — no result is presented unlabeled).
 */
import { describe, expect, it } from 'vitest';
import { EvidenceKernel } from '../src/kernel.js';
import { ACTORS, nextId, submitInput } from './helpers.js';

function newKernel() {
  return new EvidenceKernel({ idGen: () => nextId('res') });
}

describe('submit', () => {
  it('assigns L1 to an AI-proposed decompilation (AI proposes, never observes)', () => {
    const kernel = newKernel();

    const result = kernel.submit(submitInput(), ACTORS.ai);

    expect(result.verification.state).toBe('L1');
    expect(result.verification.warnings).toEqual([]);
    expect(result.provenance).toHaveLength(1);
    expect(result.provenance[0]!.actor).toEqual(ACTORS.ai);
    expect(result.provenance[0]!.toState).toBe('L1');
  });

  it('assigns L0 only to an engine directly observing bytes', () => {
    const kernel = newKernel();

    const result = kernel.submit(
      submitInput({ claim: { kind: 'observed-bytes', payload: { hex: '55488be8' } } }),
      ACTORS.engine,
    );

    expect(result.verification.state).toBe('L0');
  });

  it('refuses an AI claim of direct byte observation (AI Authority Boundary)', () => {
    const kernel = newKernel();

    expect(() =>
      kernel.submit(
        submitInput({ claim: { kind: 'observed-bytes', payload: {} } }),
        ACTORS.ai,
      ),
    ).toThrowError(/AI_AUTHORITY_BOUNDARY/);
  });

  it('rejects inputs failing the contract schema', () => {
    const kernel = newKernel();

    const bad = submitInput({ binaryHash: 'short' });
    expect(() => kernel.submit(bad, ACTORS.engine)).toThrowError(/binaryHash/);
  });
});
