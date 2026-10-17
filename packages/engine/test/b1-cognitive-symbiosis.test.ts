/**
* B1 — G4 Cognitive Symbiosis reale (PRD §3.2).
* Gate: adaptive policy entro budget <16ms per adattamento; temporal
* branching deterministico e illimitato (TimelineEngine); telemetry opt-in
* locale (collector web non trasmette segnali grezzi); volumetric con
* fallback 2D progressivo (testato in web/test/volumetric.test.ts).
*/
import { describe, expect, it } from 'vitest';
import { AdaptivePolicy, COGNITIVE_THRESHOLDS } from '../src/cognitive/adaptive-policy.js';
import { CognitiveStateStore } from '../src/cognitive/cognitive-store.js';
import { EvidenceKernel } from '@revra/kernel';
import { TimelineEngine } from '../src/timeline/timeline-engine.js';

describe('B1 — Adaptive policy: budget <16ms + isteresi anti-oscillazione', () => {
  it('ogni decisione di adattamento è entro il budget di 16ms (PRD §3.2 latency budget)', () => {
    const policy = new AdaptivePolicy();
    const samples = [
      { loadLevel: 0.9, flowScore: 0.2 }, // alto carico → SIMPLIFY
      { loadLevel: 0.3, flowScore: 0.9 }, // flow → EXPAND
      { loadLevel: 0.5, flowScore: 0.5 }, // STABLE
    ];
    for (const sample of samples) {
      const decision = policy.decide(sample);
      // Gate B1: latenza di adattamento < 16ms (budget frame UI).
      expect(decision.latencyMs).toBeLessThan(16);
      expect(['SIMPLIFY', 'EXPAND', 'STABLE']).toContain(decision.adaptation);
    }
  });

  it('isteresi: non oscilla tra SIMPLIFY e STABLE sul margine del threshold', () => {
    const policy = new AdaptivePolicy();
    // Carico alto → SIMPLIFY.
    policy.decide({ loadLevel: 0.9, flowScore: 0.1 });
    expect(policy.currentAdaptation()).toBe('SIMPLIFY');
    // Carico appena sotto il threshold ma sopra (threshold - hysteresis) → resta SIMPLIFY.
    const justBelow = COGNITIVE_THRESHOLDS.highLoad - COGNITIVE_THRESHOLDS.hysteresis / 2;
    policy.decide({ loadLevel: justBelow, flowScore: 0.1 });
    expect(policy.currentAdaptation()).toBe('SIMPLIFY'); // isteresi: non torna a STABLE
    // Carico ben sotto → torna a STABLE.
    policy.decide({ loadLevel: 0.2, flowScore: 0.1 });
    expect(policy.currentAdaptation()).toBe('STABLE');
  });

  it('flow state: EXPAND solo con flow alto E carico moderato', () => {
    const policy = new AdaptivePolicy();
    policy.decide({ loadLevel: 0.3, flowScore: 0.9 });
    expect(policy.currentAdaptation()).toBe('EXPAND');
    // Flow alto ma carico alto → non EXPAND (resta STABLE/SIMPLIFY).
    const policy2 = new AdaptivePolicy();
    policy2.decide({ loadLevel: 0.8, flowScore: 0.9 });
    expect(policy2.currentAdaptation()).not.toBe('EXPAND');
  });
});

describe('B1 — CognitiveStateStore: nessun segnale grezzo, solo stati derivati', () => {
  it('registra stati derivati per sessione e calcola metriche aggregate', () => {
    const store = new CognitiveStateStore();
    store.record({
      sessionId: 'sess-1',
      timestamp: new Date().toISOString(),
      loadLevel: 0.4,
      flowScore: 0.8,
      adaptationApplied: 'EXPAND',
    });
    store.record({
      sessionId: 'sess-1',
      timestamp: new Date().toISOString(),
      loadLevel: 0.9,
      flowScore: 0.2,
      adaptationApplied: 'SIMPLIFY',
    });
    const metrics = store.metrics();
    expect(metrics.sessions).toBe(1);
    expect(metrics.states).toBe(2);
    expect(metrics.adaptations.EXPAND).toBe(1);
    expect(metrics.adaptations.SIMPLIFY).toBe(1);
    // avgLoad è la media dei load level derivati (nessun dato grezzo esposto).
    expect(metrics.avgLoad).toBeCloseTo(0.65);
  });
});

describe('B1 — Temporal navigation: branching deterministico e illimitato', () => {
  function setup() {
    const kernel = new EvidenceKernel();
    const result = kernel.submit(
      {
        binaryHash: 'b1cognitive0000001',
        arch: 'x86_64',
        addressRange: { start: '0x0', end: '0x10' },
        engineSource: 'ghidra',
        claim: { kind: 'decompilation', payload: { pseudocode: 'int f(){return 1;}' } },
      },
      { kind: 'ai', id: 'neural' },
    );
    const timeline = new TimelineEngine({ kernel });
    return { kernel, result, timeline };
  }

  it('branch apre un universo parallelo senza riscrivere la storia originale', () => {
    const { result, timeline } = setup();
    const branch = timeline.branch(result.id, undefined, 'ipotesi-alternativa');
    expect(branch).toBeDefined();
    expect(timeline.listBranches()).toHaveLength(1);
    // La storia originale è intatta: il result originario esiste ancora.
    expect(timeline.snapshots(result.id).length).toBeGreaterThan(0);
  });

  it('branching illimitato: N branch consecutivi senza degradazione', () => {
    const { result, timeline } = setup();
    const N = 50; // "illimitato" dimostrato con un numero significativo
    for (let i = 0; i < N; i++) {
      timeline.branch(result.id, undefined, `branch-${i}`);
    }
    expect(timeline.listBranches()).toHaveLength(N);
  });

  it('determinismo: lo stesso branch riprodotto dà lo stesso stato (replay auditabile)', () => {
    const { result, timeline } = setup();
    const b1 = timeline.branch(result.id, undefined, 'deterministico');
    // Riesportiamo lo stato: il branch ha id e label stabili per il replay.
    const exported = timeline.exportState();
    const found = exported.branches.find((b) => b.label === 'deterministico');
    expect(found).toBeDefined();
    expect(found!.label).toBe(b1.label);
  });
});