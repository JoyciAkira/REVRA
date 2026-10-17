/**
 * Reconciliation seam — Conflict Visibility (PRD §0.2, §3.1): differing
 * engine outputs surface as DISPUTED with both sides' evidence and an open
 * counterexample request; agreement unifies into a single superseding result.
 */
import { describe, expect, it } from 'vitest';
import { EvidenceKernel } from '../src/kernel.js';
import { ACTORS, nextId, submitInput } from './helpers.js';

function newKernel() {
  return new EvidenceKernel({ idGen: () => nextId('res') });
}

function twoResults(kernel: EvidenceKernel, overridesB: Parameters<typeof submitInput>[0] = {}) {
  const a = kernel.submit(submitInput(), ACTORS.ai);
  const b = kernel.submit(submitInput({ engineSource: 'radare2', ...overridesB }), ACTORS.ai);
  return { a, b };
}

describe('reconcile with differing claims', () => {
  it('marks both sides DISPUTED and opens a counterexample request', () => {
    const kernel = newKernel();
    const { a, b } = twoResults(kernel, {
      claim: { kind: 'decompilation', payload: { pseudocode: 'int f() { return 2; }' } },
    });

    const report = kernel.reconcile(a.id, b.id);

    expect(report.outcome).toBe('DISPUTED');
    expect(report.counterexampleRequested).toBe(true);
    expect(report.disputedSides?.map((s) => s.resultId).sort()).toEqual([a.id, b.id].sort());
    expect(kernel.getResult(a.id)?.verification.state).toBe('DISPUTED');
    expect(kernel.getResult(b.id)?.verification.state).toBe('DISPUTED');
  });

  it('keeps both claims visible in the report with their engine sources', () => {
    const kernel = newKernel();
    const { a, b } = twoResults(kernel, {
      engineSource: 'radare2',
      claim: { kind: 'decompilation', payload: { pseudocode: 'int f() { return 2; }' } },
    });

    const report = kernel.reconcile(a.id, b.id);

    const engines = report.disputedSides?.map((s) => s.engineSource);
    expect(engines).toContain('ghidra');
    expect(engines).toContain('radare2');
  });
});

describe('reconcile with agreeing claims', () => {
  it('unifies into a superseding result at the highest level of the two', () => {
    const kernel = newKernel();
    const { a, b } = twoResults(kernel);
    kernel.promote(b.id, 'L2', ACTORS.symbolic, { evidenceRef: 'test://b-passes' });

    const report = kernel.reconcile(a.id, b.id);

    expect(report.outcome).toBe('UNIFIED');
    const unified = kernel.getResult(report.unifiedResultId!)!;
    expect(unified.verification.state).toBe('L2');
    expect(unified.claim).toEqual(a.claim);
    expect(report.counterexampleRequested).toBe(false);
  });

  it('records the originals as superseded without discarding their history', () => {
    const kernel = newKernel();
    const { a, b } = twoResults(kernel);

    const report = kernel.reconcile(a.id, b.id);

    const lastA = kernel.getResult(a.id)!.provenance.at(-1)!;
    expect(lastA.action).toBe('superseded-by');
    expect(lastA.params?.unifiedResultId).toBe(report.unifiedResultId);
    expect(kernel.getResult(a.id)).toBeDefined();
    expect(kernel.getProvenance(a.id)).toHaveLength(2);
  });
});

describe('reconcile guards', () => {
  it('refuses results from different binaries', () => {
    const kernel = newKernel();
    const { a } = twoResults(kernel);
    const other = kernel.submit(submitInput({ binaryHash: 'deadbeefdeadbeef' }), ACTORS.ai);

    expect(() => kernel.reconcile(a.id, other.id)).toThrowError(/RECONCILE_INCOMPATIBLE/);
  });

  it('refuses non-overlapping address ranges in the same binary', () => {
    const kernel = newKernel();
    const { a } = twoResults(kernel);
    const elsewhere = kernel.submit(
      submitInput({ addressRange: { start: '0x500000', end: '0x5000ff' } }),
      ACTORS.ai,
    );

    expect(() => kernel.reconcile(a.id, elsewhere.id)).toThrowError(/RECONCILE_INCOMPATIBLE/);
  });

  it('refuses reconciling a result with itself or an already-disputed result', () => {
    const kernel = newKernel();
    const { a, b } = twoResults(kernel, {
      claim: { kind: 'decompilation', payload: { pseudocode: 'int f() { return 2; }' } },
    });

    expect(() => kernel.reconcile(a.id, a.id)).toThrowError(/INVALID_TRANSITION/);

    kernel.reconcile(a.id, b.id);
    const c = kernel.submit(submitInput(), ACTORS.ai);
    expect(() => kernel.reconcile(a.id, c.id)).toThrowError(/INVALID_TRANSITION/);
  });
});
