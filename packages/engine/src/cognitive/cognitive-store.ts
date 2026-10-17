/**
 * In-memory registry of derived cognitive states, per analysis session
 * (PRD §7 CognitiveState: session_id, timestamp, load_level, flow_score,
 * adaptation_applied). Append-only; no raw signal ever reaches this store.
 */
import type { CognitiveState, UiAdaptation } from '@revra/contracts';
import type { SessionMetrics } from './types.js';

export class CognitiveStateStore {
  private readonly bySession = new Map<string, CognitiveState[]>();

  record(state: CognitiveState): number {
    const list = this.bySession.get(state.sessionId) ?? [];
    list.push(state);
    this.bySession.set(state.sessionId, list);
    return list.length;
  }

  forSession(sessionId: string): CognitiveState[] {
    return [...(this.bySession.get(sessionId) ?? [])];
  }

  metrics(): SessionMetrics {
    const all = [...this.bySession.values()].flat();
    const adaptations: Record<UiAdaptation, number> = { SIMPLIFY: 0, EXPAND: 0, STABLE: 0 };
    let flowStates = 0;
    let loadSum = 0;
    for (const s of all) {
      adaptations[s.adaptationApplied] += 1;
      loadSum += s.loadLevel;
      if (s.flowScore >= 0.7) flowStates += 1;
    }
    return {
      sessions: this.bySession.size,
      states: all.length,
      avgLoad: all.length > 0 ? loadSum / all.length : null,
      flowTimePct: all.length > 0 ? flowStates / all.length : null,
      adaptations,
    };
  }
}
