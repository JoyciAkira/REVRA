/**
 * F0.3 round-trip: epistemic e timeline sopravvivono a export → restore.
 */
import { describe, expect, it } from 'vitest';
import { EvidenceKernel } from '@revra/kernel';
import { EpistemicEngine } from '../src/epistemic/epistemic-engine.js';
import { TimelineEngine } from '../src/timeline/timeline-engine.js';
import { ACTORS, submitInput } from './helpers.js';

const NOW = '2026-10-11T00:00:00.000Z';

describe('EpistemicEngine round-trip', () => {
  it('restores patterns, hypotheses and causal edges', () => {
    const engine = new EpistemicEngine();
    engine.learnPattern('x86_64', 'ghidra', 'updater-ransom', NOW);
    const [hypothesis] = engine.generate(
      { binaryHash: 'a1b2c3d4e5f60718', arch: 'x86_64', firstEngineSource: 'ghidra' },
      NOW,
    );
    engine.applyVerdict(hypothesis!.id, 'CONFIRMED');
    engine.recordObservation('obfuscation', 'complexity', 'differential', NOW);

    const restored = new EpistemicEngine();
    restored.restore(engine.exportState());

    expect(restored.listHypotheses()[0]!.status).toBe('CONFIRMED');
    expect(restored.metrics().patterns).toBe(1);
    expect(restored.relationBetween('obfuscation', 'complexity').relation).toBe('causal');

    // Il meta-learning continua dopo il restore: verdict su nuova ipotesi.
    const [next] = restored.generate(
      { binaryHash: 'b2c3d4e5f6071899', arch: 'x86_64', firstEngineSource: 'ghidra' },
      NOW,
    );
    expect(next!.confidence).toBeGreaterThan(0.3);
  });
});

describe('TimelineEngine round-trip', () => {
  it('restores the branch registry and continues the counter', () => {
    const kernel = new EvidenceKernel();
    const timeline = new TimelineEngine({ kernel });
    const result = kernel.submit(submitInput(), ACTORS.ai);
    const branch = timeline.branch(result.id, undefined, 'universe-restored');

    const restored = new TimelineEngine({ kernel });
    restored.restore(timeline.exportState());

    expect(restored.listBranches().map((b) => b.branchId)).toContain(branch.branchId);
    const second = restored.branch(result.id, undefined, 'universe-2');
    expect(second.branchId).not.toBe(branch.branchId);
  });
});
