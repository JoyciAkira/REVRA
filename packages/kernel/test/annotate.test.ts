/**
 * Annotation seam: note causal/appuntate sulla timeline senza cambiare lo
 * stato di evidenza — append-only come ogni evento (usata dal branching G4).
 */
import { describe, expect, it } from 'vitest';
import { EvidenceKernel } from '../src/kernel.js';
import { ACTORS, nextId, submitInput } from './helpers.js';

describe('annotate', () => {
  it('appends a note without moving the evidence level', () => {
    const kernel = new EvidenceKernel({ idGen: () => nextId('res') });
    const result = kernel.submit(submitInput(), ACTORS.ai);

    const annotated = kernel.annotate(result.id, ACTORS.analyst, 'collegata a CVE-2026-1234');

    expect(annotated.verification.state).toBe('L1');
    const last = annotated.provenance.at(-1)!;
    expect(last.action).toBe('annotate');
    expect(last.note).toBe('collegata a CVE-2026-1234');
    expect(last.fromState).toBe('L1');
    expect(last.toState).toBe('L1');
  });

  it('rejects annotations on unknown results', () => {
    const kernel = new EvidenceKernel({ idGen: () => nextId('res') });
    expect(() => kernel.annotate('missing', ACTORS.analyst, 'x')).toThrowError(/RESULT_NOT_FOUND/);
  });
});
