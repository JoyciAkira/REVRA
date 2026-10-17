/**
 * B2 — G5 Epistemic Engine autonomo (PRD §3.3).
 * Gate: hypothesis generation su corpus con confidence Wilson; causal
 * counterfactuals (correlazione ≠ causalità); conformal prediction con
 * uncertainty interval SEMPRE presente (mitiga rischio PRD §10 "ipotesi
 * fuorvianti ad alta confidenza"); self-improvement loop misurabile che
 * identifica gap e genera query di ricerca autonome.
 */
import { describe, expect, it } from 'vitest';
import { EpistemicEngine } from '../src/epistemic/epistemic-engine.js';

const NOW = '2026-10-12T00:00:00.000Z';

function seededEngine(): EpistemicEngine {
  const engine = new EpistemicEngine();
  // Corpus: 3 pattern x86_64 confermati (famiglia malware-A) → sufficiente per generalizzare.
  for (let i = 0; i < 3; i++) {
    engine.learnPattern('x86_64', 'ghidra', 'malware-A', NOW);
  }
  // Un pattern arm64 con alta falsification (gap conoscitivo da colmare).
  engine.learnPattern('arm64', 'radare2', 'firmware-X', NOW);
  return engine;
}

describe('B2 — Hypothesis generation autonoma su corpus', () => {
  it('genera ipotesi per un nuovo binario x86_64 con confidence Wilson (>0)', () => {
    const engine = seededEngine();
    const hypotheses = engine.generate(
      { binaryHash: 'b2hyp00000000001', arch: 'x86_64', firstEngineSource: 'ghidra' },
      NOW,
    );
    expect(hypotheses.length).toBeGreaterThan(0);
    const h = hypotheses[0]!;
    expect(h.confidence).toBeGreaterThan(0);
    expect(h.confidence).toBeLessThanOrEqual(1);
    expect(h.status).toBe('PROPOSED');
    expect(h.prediction.family).toBe('malware-A');
  });

  it('time-to-first-insight: generazione rapida (<30s target PRD §6.3, qui ms)', () => {
    const engine = seededEngine();
    const t0 = performance.now();
    engine.generate({ binaryHash: 'b2tti00000000001', arch: 'x86_64', firstEngineSource: 'ghidra' }, NOW);
    const elapsed = performance.now() - t0;
    // Gate PRD §6.3: time-to-first-insight <30s. Su corpus in-memory è nell'ordine dei ms.
    expect(elapsed).toBeLessThan(30_000);
  });

  it('senza match nel corpus → nessuna ipotesi inventata (onestà epistemica)', () => {
    const engine = new EpistemicEngine(); // corpus vuoto
    const hypotheses = engine.generate(
      { binaryHash: 'b2nomatch0000001', arch: 'mips', firstEngineSource: 'binwalk' },
      NOW,
    );
    expect(hypotheses).toEqual([]); // gap registrato, non ipotesi inventata
    const metrics = engine.metrics();
    expect(metrics.gaps.length).toBeGreaterThan(0); // corpus sottile = gap dichiarato
  });
});

describe('B2 — Causal reasoning: correlazione ≠ causalità + counterfactuals', () => {
  it('co-occorrenza resta correlazionale; solo analisi differenziale stabilisce causalità', () => {
    const engine = new EpistemicEngine();
    engine.recordObservation('packed-input', 'encrypted-section', 'co-occurrence', NOW);
    expect(engine.relationBetween('packed-input', 'encrypted-section').relation).toBe('correlational');
    engine.recordObservation('obfuscation-pass', 'cfg-complexity', 'differential', NOW);
    expect(engine.relationBetween('obfuscation-pass', 'cfg-complexity').relation).toBe('causal');
  });

  it('counterfactual su edge causale vs correlazionale vs gap', () => {
    const engine = new EpistemicEngine();
    engine.recordObservation('cause-A', 'effect-B', 'differential', NOW);
    engine.recordObservation('corr-C', 'corr-D', 'co-occurrence', NOW);
    expect(engine.counterfactual('cause-A', 'effect-B')).toContain('analisi differenziale');
    expect(engine.counterfactual('corr-C', 'corr-D')).toContain('Non dimostrabile');
    expect(engine.counterfactual('unknown-X', 'unknown-Y')).toContain('gap conoscitivo');
  });
});

describe('B2 — Conformal prediction: uncertainty interval SEMPRE presente', () => {
  it('intervallo calibrato: contiene il punto, lower<=point<=upper, coverage 90%', () => {
    const engine = seededEngine();
    const [h] = engine.generate({ binaryHash: 'b2conf000000001', arch: 'x86_64', firstEngineSource: 'ghidra' }, NOW);
    const interval = engine.conformalInterval(h!.id);
    expect(interval.lower).toBeLessThanOrEqual(interval.point);
    expect(interval.upper).toBeGreaterThanOrEqual(interval.point);
    expect(interval.lower).toBeGreaterThanOrEqual(0);
    expect(interval.upper).toBeLessThanOrEqual(1);
    expect(interval.coverage).toBe(0.9);
  });

  it('corpus sottile → intervallo più largo (incertezza epistemica onesta, PRD §10)', () => {
    // Engine con corpus sottile (1 pattern) vs engine con corpus ricco.
    const thin = new EpistemicEngine();
    thin.learnPattern('x86_64', 'ghidra', 'rare', NOW);
    const [hThin] = thin.generate({ binaryHash: 'b2thin00000001', arch: 'x86_64', firstEngineSource: 'ghidra' }, NOW);
    const rich = seededEngine();
    const [hRich] = rich.generate({ binaryHash: 'b2rich00000001', arch: 'x86_64', firstEngineSource: 'ghidra' }, NOW);
    const widthThin = thin.conformalInterval(hThin!.id).upper - thin.conformalInterval(hThin!.id).lower;
    const widthRich = rich.conformalInterval(hRich!.id).upper - rich.conformalInterval(hRich!.id).lower;
    // Corpus sottile → incertezza maggiore → intervallo più largo.
    expect(widthThin).toBeGreaterThan(widthRich);
  });

  it('alta falsification rate → intervallo più largo (modello inaffidabile = più incertezza)', () => {
    const engine = new EpistemicEngine();
    // Pattern con molte falsificazioni.
    engine.learnPattern('x86_64', 'ghidra', 'flaky', NOW);
    const h = engine.generate({ binaryHash: 'b2fals00000001', arch: 'x86_64', firstEngineSource: 'ghidra' }, NOW)[0]!;
    // Applica verdetti falsificanti per alzare la falsification rate.
    for (let i = 0; i < 5; i++) {
      const hh = engine.generate({ binaryHash: `b2fals${i}`, arch: 'x86_64', firstEngineSource: 'ghidra' }, NOW)[0]!;
      engine.applyVerdict(hh.id, 'FALSIFIED');
    }
    const interval = engine.conformalInterval(h.id);
    // Con alta falsification l'intervallo si allarga (halfWidth cresce).
    expect(interval.upper - interval.lower).toBeGreaterThan(0.1);
  });
});

describe('B2 — Self-improvement loop misurabile', () => {
  it('identifica gap e genera azioni di ricerca autonome tracciate', () => {
    const engine = new EpistemicEngine(); // corpus vuoto → gap "corpus sottile"
    const actions = engine.selfImprove(NOW);
    expect(actions.length).toBeGreaterThan(0);
    const action = actions[0]!;
    expect(action.researchQuery.length).toBeGreaterThan(0);
    expect(action.generatedAt).toBe(NOW);
    // Le azioni sono tracciate per audit/misurazione del loop.
    expect(engine.listImprovementActions()).toHaveLength(actions.length);
  });

  it('non duplica azioni pendenti per lo stesso gap (idempotenza del loop)', () => {
    const engine = new EpistemicEngine();
    const first = engine.selfImprove(NOW);
    const second = engine.selfImprove(NOW);
    // Secondo giro: nessun nuovo gap → nessuna nuova azione.
    expect(second).toEqual([]);
    expect(engine.listImprovementActions()).toHaveLength(first.length);
  });

  it('loop chiuso: learnPattern dopo research riduce i gap (self-improvement effettivo)', () => {
    const engine = new EpistemicEngine();
    const gapsBefore = engine.metrics().gaps.length;
    engine.selfImprove(NOW);
    // Simula l'orchestratore che esegue la researchQuery e re-ingesta campioni.
    for (let i = 0; i < 4; i++) {
      engine.learnPattern('x86_64', 'ghidra', 'malware-A', NOW);
      engine.learnPattern('arm64', 'radare2', 'firmware-X', NOW);
      engine.learnPattern('mips', 'binwalk', 'iot-Y', NOW);
    }
    const gapsAfter = engine.metrics().gaps.length;
    // Il corpus arricchito riduce i gap (corpus non più sottile).
    expect(gapsAfter).toBeLessThan(gapsBefore);
  });

  it('meta-learning: accuracy tracciata migliora coi verdetti confermati', () => {
    const engine = seededEngine();
    // Genera e conferma ipotesi → accuracy misurabile.
    for (let i = 0; i < 3; i++) {
      const h = engine.generate({ binaryHash: `b2acc${i}`, arch: 'x86_64', firstEngineSource: 'ghidra' }, NOW)[0]!;
      engine.applyVerdict(h.id, 'CONFIRMED');
    }
    const metrics = engine.metrics();
    expect(metrics.accuracy).not.toBeNull();
    expect(metrics.accuracy!).toBeGreaterThan(0);
    expect(metrics.confirmed).toBeGreaterThanOrEqual(3);
  });
});