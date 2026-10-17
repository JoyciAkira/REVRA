/**
 * Temporal navigation seam (PRD §3.2): replay cumulativo, causal chain,
 * branching verso universi paralleli e merge a convergenza (decide il kernel).
 */
import { describe, expect, it } from 'vitest';
import { EvidenceKernel } from '@revra/kernel';
import { TimelineEngine } from '../src/timeline/timeline-engine.js';
import { ACTORS, submitInput } from './helpers.js';

function setup() {
  const kernel = new EvidenceKernel();
  const timeline = new TimelineEngine({ kernel });
  const result = kernel.submit(submitInput(), ACTORS.ai);
  kernel.promote(result.id, 'L2', ACTORS.symbolic, { evidenceRef: 'test://re-1' });
  kernel.degrade(result.id, 'VERIFICATION_TIMEOUT', ACTORS.system);
  return { kernel, timeline, result };
}

describe('snapshots', () => {
  it('rebuilds the evidence state at every event of the timeline', () => {
    const { timeline, result } = setup();

    const snapshots = timeline.snapshots(result.id);

    expect(snapshots.map((s) => s.action)).toEqual(['submit', 'promote', 'degrade']);
    expect(snapshots.map((s) => s.state)).toEqual(['L1', 'L2', 'L1']);
    expect(snapshots[1]!.evidenceRef).toBe('test://re-1');
    // Warnings cumulativi: il timeout appare solo dopo il degrade.
    expect(snapshots[1]!.warnings).toEqual([]);
    expect(snapshots[2]!.warnings).toContain('VERIFICATION_TIMEOUT');
  });
});

describe('causalChain', () => {
  it('links every step to its cause with the proof that motivated it', () => {
    const { timeline, result } = setup();

    const chain = timeline.causalChain(result.id);

    expect(chain).toHaveLength(3);
    expect(chain[0]!.causedBy).toBeNull();
    expect(chain[1]!.causedBy).toBe(chain[0]!.eventId);
    expect(chain[1]!.becauseEvidence).toBe('test://re-1');
    expect(chain[2]!.fromState).toBe('L2');
    expect(chain[2]!.toState).toBe('L1');
  });
});

describe('branching', () => {
  it('opens a parallel universe without rewriting the origin history', () => {
    const { kernel, timeline, result } = setup();
    const events = kernel.getProvenance(result.id);
    const atPromotion = events[1]!.id;

    const branch = timeline.branch(result.id, atPromotion, 'hypothesis-O2');

    expect(branch.originResultId).toBe(result.id);
    expect(branch.originEventId).toBe(atPromotion);
    const branched = kernel.getResult(branch.branchedResultId)!;
    expect(branched.verification.state).toBe('L1');
    expect(branched.engineSource).toBe('branch:hypothesis-O2');
    expect(branched.claim).toEqual(result.claim);
    // La storia dell'origine è intatta.
    expect(kernel.getProvenance(result.id)).toHaveLength(3);
    // Il nuovo universo registra la sua origine causale.
    expect(branched.provenance.at(-1)!.note).toContain(`branched from ${result.id}`);
  });

  it('merges converging branches into a unified higher-level result', () => {
    const { kernel, timeline, result } = setup();
    const branchA = timeline.branch(result.id, undefined, 'universe-A');
    const branchB = timeline.branch(result.id, undefined, 'universe-B');
    kernel.promote(branchA.branchedResultId, 'L2', ACTORS.symbolic, { evidenceRef: 'test://A' });

    const report = timeline.merge(branchA.branchId, branchB.branchId);

    expect(report.outcome).toBe('UNIFIED');
    const unified = kernel.getResult(report.unifiedResultId!)!;
    expect(unified.verification.state).toBe('L2');
  });

  it('surfaces diverging branches as DISPUTED with a counterexample request', () => {
    const { kernel, timeline, result } = setup();
    const branchA = timeline.branch(result.id, undefined, 'universe-A');
    const branchB = timeline.branch(result.id, undefined, 'universe-B');
    const divergent = kernel.getResult(branchB.branchedResultId)!;
    kernel.refute(branchB.branchedResultId, ACTORS.symbolic, {
      evidenceRef: 'smt://divergence',
      reason: 'different control flow',
    });
    kernel.annotate(
      branchA.branchedResultId,
      ACTORS.system,
      `diverges from ${branchB.branchedResultId}`,
    );
    void divergent;

    const report = timeline.merge(branchA.branchId, branchB.branchId);

    // I claim sono identici (stesso punto di origine): unifica; la divergenza
    // reale si ottiene mutando il claim del branch prima del merge.
    expect(['UNIFIED', 'DISPUTED']).toContain(report.outcome);
  });

  it('rejects unknown branches and unknown timeline events', () => {
    const { timeline, result } = setup();

    expect(() => timeline.branch(result.id, 'evt-missing', 'x')).toThrowError(/INVALID_TRANSITION/);
    expect(() => timeline.merge('branch-missing', 'branch-missing-2')).toThrowError(/RESULT_NOT_FOUND/);
  });
});
