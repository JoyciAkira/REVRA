/**
 * Cognitive symbiosis seams (PRD §3.2): adaptive policy with hysteresis and
 * sub-16ms decision budget, append-only state registry, BCI adapter bridge.
 */
import { describe, expect, it } from 'vitest';
import { AdaptivePolicy, COGNITIVE_THRESHOLDS } from '../src/cognitive/adaptive-policy.js';
import { BciAdapterUnsupported, BciBridge } from '../src/cognitive/bci.js';
import { CognitiveStateStore } from '../src/cognitive/cognitive-store.js';
import type { CognitiveState } from '@revra/contracts';

function state(overrides: Partial<CognitiveState> = {}): CognitiveState {
  return {
    sessionId: 'sess-1',
    ts: '2026-10-11T00:00:00.000Z',
    loadLevel: 0.4,
    flowScore: 0.6,
    source: 'keyboard-mouse',
    adaptationApplied: 'STABLE',
    ...overrides,
  };
}

describe('AdaptivePolicy', () => {
  it('simplifies under high load and expands in flow with moderate load', () => {
    const policy = new AdaptivePolicy();

    expect(policy.decide({ loadLevel: 0.9, flowScore: 0.2 }).adaptation).toBe('SIMPLIFY');
    policy.decide({ loadLevel: 0.4, flowScore: 0.6 });
    const expand = policy.decide({ loadLevel: 0.3, flowScore: 0.9 });
    expect(expand.adaptation).toBe('EXPAND');
    expect(expand.changed).toBe(true);
  });

  it('holds SIMPLIFY until load drops below threshold minus hysteresis', () => {
    const policy = new AdaptivePolicy();
    policy.decide({ loadLevel: 0.9, flowScore: 0.2 });

    // Still above highLoad − hysteresis: stays SIMPLIFY.
    const sticky = policy.decide({ loadLevel: COGNITIVE_THRESHOLDS.highLoad - 0.05, flowScore: 0.2 });
    expect(sticky.adaptation).toBe('SIMPLIFY');
    expect(sticky.changed).toBe(false);

    // Below the hysteresis band: releases to STABLE.
    const released = policy.decide({ loadLevel: COGNITIVE_THRESHOLDS.highLoad - 0.2, flowScore: 0.2 });
    expect(released.adaptation).toBe('STABLE');
    expect(released.changed).toBe(true);
  });

  it('decides well inside the 16ms adaptation budget (1000 decisions)', () => {
    const policy = new AdaptivePolicy();
    const t0 = performance.now();
    for (let i = 0; i < 1000; i += 1) {
      policy.decide({ loadLevel: (i % 100) / 100, flowScore: ((i * 7) % 100) / 100 });
    }
    const totalMs = performance.now() - t0;
    // Budget is per-adaptation; 1000 decisions must not consume one budget together.
    expect(totalMs).toBeLessThan(16);
  });
});

describe('CognitiveStateStore', () => {
  it('keeps per-session append-only history in order', () => {
    const store = new CognitiveStateStore();
    store.record(state({ ts: '2026-10-11T00:00:01.000Z', loadLevel: 0.2 }));
    store.record(state({ ts: '2026-10-11T00:00:02.000Z', loadLevel: 0.8 }));
    store.record(state({ sessionId: 'sess-2' }));

    const history = store.forSession('sess-1');
    expect(history).toHaveLength(2);
    expect(history[0]!.loadLevel).toBe(0.2);
    expect(history[1]!.loadLevel).toBe(0.8);
    expect(store.forSession('sess-1')).toHaveLength(2); // reads are copies of the list
  });

  it('aggregates metrics: sessions, flow share, adaptation histogram', () => {
    const store = new CognitiveStateStore();
    store.record(state({ flowScore: 0.9, adaptationApplied: 'EXPAND' }));
    store.record(state({ loadLevel: 0.9, adaptationApplied: 'SIMPLIFY' }));
    store.record(state({ sessionId: 'sess-2', adaptationApplied: 'STABLE' }));

    const metrics = store.metrics();
    expect(metrics.sessions).toBe(2);
    expect(metrics.states).toBe(3);
    expect(metrics.avgLoad).toBeCloseTo((0.4 + 0.9 + 0.4) / 3);
    expect(metrics.flowTimePct).toBeCloseTo(1 / 3);
    expect(metrics.adaptations).toEqual({ SIMPLIFY: 1, EXPAND: 1, STABLE: 1 });
  });
});

describe('BciBridge', () => {
  const registration = {
    adapterId: 'neuro-puck-1',
    vendor: 'OpenBCI',
    modalities: ['EEG'],
    sampleRateHz: 250,
  } as const;

  it('registers adapters and normalizes device samples with bounded guards', () => {
    const bridge = new BciBridge();
    bridge.register(registration, '2026-10-11T00:00:00.000Z');

    const sample = bridge.normalize({
      adapterId: 'neuro-puck-1',
      loadLevel: 1.4,
      flowScore: -0.2,
      ts: '2026-10-11T00:00:01.000Z',
    });
    expect(sample).toEqual({ loadLevel: 1, flowScore: 0 });
    expect(bridge.list()).toHaveLength(1);
  });

  it('answers UNSUPPORTED for unregistered adapters — no silent fallback', () => {
    const bridge = new BciBridge();

    expect(() =>
      bridge.normalize({ adapterId: 'ghost', loadLevel: 0.5, flowScore: 0.5, ts: 'x' }),
    ).toThrowError(BciAdapterUnsupported);
  });
});
