/**
 * Epistemic engine seam (PRD §3.3): ipotesi autonome falsificabili con
 * confidence Wilson, causalità solo per via differenziale, meta-learning
 * dai verdetti, gap knowledge e metriche di accuracy.
 */
import { describe, expect, it } from 'vitest';
import { EpistemicEngine } from '../src/epistemic/epistemic-engine.js';

const NOW = '2026-10-11T00:00:00.000Z';

function engineWithCorpus(): EpistemicEngine {
  const engine = new EpistemicEngine();
  // Corpus: la famiglia "updater-ransom" vista 3 volte via ghidra su x86_64.
  for (let i = 0; i < 3; i += 1) {
    engine.learnPattern('x86_64', 'ghidra', 'updater-ransom', NOW);
  }
  return engine;
}

describe('autonomous hypothesis generation', () => {
  it('proposes a falsifiable hypothesis with Wilson confidence for a matching binary', () => {
    const engine = engineWithCorpus();

    const [hypothesis] = engine.generate(
      { binaryHash: 'a1b2c3d4e5f60718', arch: 'x86_64', firstEngineSource: 'ghidra' },
      NOW,
    );

    expect(hypothesis.status).toBe('PROPOSED');
    expect(hypothesis.prediction.family).toBe('updater-ransom');
    expect(hypothesis.confidence).toBeGreaterThan(0.3);
    expect(hypothesis.confidence).toBeLessThan(0.95);
    // Time-to-first-insight: misurato e nel target PRD (<30s).
    expect(hypothesis.generatedInMs).toBeLessThan(30_000);
  });

  it('registers a knowledge gap instead of inventing when nothing matches', () => {
    const engine = new EpistemicEngine();

    const hypotheses = engine.generate(
      { binaryHash: 'ffffffffffffffff', arch: 'riscv', firstEngineSource: 'unknown' },
      NOW,
    );

    expect(hypotheses).toHaveLength(0);
    expect(engine.metrics().gaps.some((g) => g.reason.includes('corpus sottile'))).toBe(true);
  });

  it('weakens weak matches (same arch, different provenance)', () => {
    const engine = engineWithCorpus();
    engine.learnPattern('x86_64', 'radare2', 'packer-generic', NOW);

    const [strong, weak] = engine.generate(
      { binaryHash: 'a1b2c3d4e5f60718', arch: 'x86_64', firstEngineSource: 'ghidra' },
      NOW,
    );

    expect(strong!.confidence).toBeGreaterThan(weak!.confidence);
  });
});

describe('verdict loop (meta-learning)', () => {
  it('updates hypothesis status and pattern statistics from verdicts', () => {
    const engine = engineWithCorpus();
    const [hypothesis] = engine.generate(
      { binaryHash: 'a1b2c3d4e5f60718', arch: 'x86_64', firstEngineSource: 'ghidra' },
      NOW,
    );

    const updated = engine.applyVerdict(hypothesis!.id, 'FALSIFIED');

    expect(updated.status).toBe('FALSIFIED');
    const metrics = engine.metrics();
    expect(metrics.accuracy).toBe(0);
    expect(metrics.falsified).toBe(1);
    // Il pattern è stato penalizzato: la prossima confidence scende.
    const [next] = engine.generate(
      { binaryHash: 'b2c3d4e5f6071899', arch: 'x86_64', firstEngineSource: 'ghidra' },
      NOW,
    );
    expect(next!.confidence).toBeLessThan(hypothesis!.confidence);
  });

  it('flags high-falsification archs as learning gaps', () => {
    const engine = engineWithCorpus();
    const [h] = engine.generate(
      { binaryHash: 'a1b2c3d4e5f60718', arch: 'x86_64', firstEngineSource: 'ghidra' },
      NOW,
    );
    engine.applyVerdict(h!.id, 'FALSIFIED');

    const gaps = engine.metrics().gaps;
    expect(gaps.some((g) => g.arch === 'x86_64' && g.reason.includes('falsification rate'))).toBe(true);
  });

  it('rejects verdicts for unknown hypotheses', () => {
    const engine = new EpistemicEngine();
    expect(() => engine.applyVerdict('hyp-missing', 'CONFIRMED')).toThrowError(/RESULT_NOT_FOUND/);
  });
});

describe('causal reasoning', () => {
  it('calls causal only what differential analysis established', () => {
    const engine = new EpistemicEngine();
    engine.recordObservation('packed-input', 'encrypted-section', 'co-occurrence', NOW);
    engine.recordObservation('obfuscation-pass', 'cfg-complexity', 'differential', NOW);

    expect(engine.relationBetween('obfuscation-pass', 'cfg-complexity')).toEqual({
      relation: 'causal',
      observations: 1,
    });
    expect(engine.relationBetween('packed-input', 'encrypted-section')).toEqual({
      relation: 'correlational',
      observations: 1,
    });
    expect(engine.relationBetween('a', 'b').relation).toBe('unknown');
  });

  it('answers counterfactuals according to the evidence class', () => {
    const engine = new EpistemicEngine();
    engine.recordObservation('obfuscation-pass', 'cfg-complexity', 'differential', NOW);
    engine.recordObservation('packed-input', 'encrypted-section', 'co-occurrence', NOW);

    expect(engine.counterfactual('obfuscation-pass', 'cfg-complexity')).toMatch(/differenziale/);
    expect(engine.counterfactual('packed-input', 'encrypted-section')).toMatch(/Non dimostrabile/);
    expect(engine.counterfactual('x', 'y')).toMatch(/gap conoscitivo/);
  });
});
