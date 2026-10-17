/**
 * Cognitive Symbiosis shared types (PRD §3.2).
 */
export interface CognitiveSample {
  /** Cognitive load proxy in [0,1]. */
  loadLevel: number;
  /** Flow-state score in [0,1]. */
  flowScore: number;
}

export interface SessionMetrics {
  sessions: number;
  states: number;
  avgLoad: number | null;
  /** Share of states recorded in flow (flowScore ≥ 0.7). */
  flowTimePct: number | null;
  adaptations: { SIMPLIFY: number; EXPAND: number; STABLE: number };
}
