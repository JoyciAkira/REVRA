/**
 * Adaptive policy (PRD §3.2): SIMPLIFY under high load, EXPAND in flow,
 * STABLE otherwise — with hysteresis so the UI does not oscillate.
 * Pure, synchronous and local: the client runs it inside the <16ms
 * adaptation budget; the server stores outcomes, it does not decide them.
 */
import type { CognitiveSample } from './types.js';
import type { UiAdaptation } from '@revra/contracts';

export const COGNITIVE_THRESHOLDS = {
  /** Above this load the UI simplifies. */
  highLoad: 0.7,
  /** Below this load (with flow) the UI expands detail. */
  moderateLoadMax: 0.5,
  /** Above this flow score (and moderate load) the UI expands detail. */
  flow: 0.7,
  /** Margin required to LEAVE a non-stable adaptation (anti-oscillation). */
  hysteresis: 0.1,
} as const;

export interface PolicyDecision {
  adaptation: UiAdaptation;
  changed: boolean;
  latencyMs: number;
}

export class AdaptivePolicy {
  private current: UiAdaptation = 'STABLE';

  decide(sample: CognitiveSample): PolicyDecision {
    const t0 = performance.now();
    let next: UiAdaptation = 'STABLE';

    if (this.current === 'SIMPLIFY') {
      // Leaving SIMPLIFY requires load to drop below the threshold minus hysteresis.
      next = sample.loadLevel < COGNITIVE_THRESHOLDS.highLoad - COGNITIVE_THRESHOLDS.hysteresis
        ? 'STABLE'
        : 'SIMPLIFY';
    } else if (this.current === 'EXPAND') {
      const stillFlowing =
        sample.flowScore >= COGNITIVE_THRESHOLDS.flow &&
        sample.loadLevel <= COGNITIVE_THRESHOLDS.moderateLoadMax + COGNITIVE_THRESHOLDS.hysteresis;
      next = stillFlowing ? 'EXPAND' : 'STABLE';
    } else {
      if (sample.loadLevel >= COGNITIVE_THRESHOLDS.highLoad) {
        next = 'SIMPLIFY';
      } else if (
        sample.flowScore >= COGNITIVE_THRESHOLDS.flow &&
        sample.loadLevel <= COGNITIVE_THRESHOLDS.moderateLoadMax
      ) {
        next = 'EXPAND';
      }
    }

    const changed = next !== this.current;
    this.current = next;
    return { adaptation: next, changed, latencyMs: performance.now() - t0 };
  }

  currentAdaptation(): UiAdaptation {
    return this.current;
  }
}
