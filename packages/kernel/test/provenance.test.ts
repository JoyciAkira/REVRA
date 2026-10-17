/**
 * Provenance seam — Provenance Preservation (PRD §0.2): the origin chain of a
 * result is append-only and never rewritten, and reads hand out copies.
 */
import { describe, expect, it } from 'vitest';
import { EvidenceKernel } from '../src/kernel.js';
import { ACTORS, nextId, submitInput } from './helpers.js';

describe('provenance', () => {
  it('preserves the full ordered chain across submit → promote → degrade', () => {
    const kernel = new EvidenceKernel({ idGen: () => nextId('res') });
    const result = kernel.submit(submitInput(), ACTORS.ai);
    kernel.promote(result.id, 'L2', ACTORS.symbolic, { evidenceRef: 'test://1' });
    kernel.degrade(result.id, 'VERIFICATION_TIMEOUT', ACTORS.system);

    const chain = kernel.getProvenance(result.id);

    expect(chain.map((e) => e.action)).toEqual(['submit', 'promote', 'degrade']);
    expect(chain[0]!.actor).toEqual(ACTORS.ai);
    expect(chain[1]!.evidenceRef).toBe('test://1');
    expect(chain[2]!.toState).toBe('L1');
  });

  it('hands out copies — mutating a read chain does not touch the kernel', () => {
    const kernel = new EvidenceKernel({ idGen: () => nextId('res') });
    const result = kernel.submit(submitInput(), ACTORS.ai);

    const chain = kernel.getProvenance(result.id);
    chain.pop();

    expect(kernel.getProvenance(result.id)).toHaveLength(1);
  });

  it('keeps the embedded result provenance and the queried chain in sync', () => {
    const kernel = new EvidenceKernel({ idGen: () => nextId('res') });
    const result = kernel.submit(submitInput(), ACTORS.ai);
    kernel.promote(result.id, 'L2', ACTORS.symbolic, { evidenceRef: 'test://1' });

    expect(kernel.getResult(result.id)!.provenance).toEqual(kernel.getProvenance(result.id));
  });
});
