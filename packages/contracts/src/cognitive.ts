/**
 * Cognitive Symbiosis contracts (PRD §3.2, §7 CognitiveState).
 *
 * Privacy-first by construction: raw signals (keystroke timings, mouse
 * samples, eye-tracking frames) NEVER leave the client. Only the derived,
 * aggregate CognitiveState crosses the API boundary. Consent is explicit.
 */
import { z } from 'zod';

export const COGNITIVE_SOURCES = [
  'keyboard-mouse',
  'eye-tracking',
  'hrv-proxy',
  'bci-eeg',
  'bci-fnirs',
] as const;
export type CognitiveSource = (typeof COGNITIVE_SOURCES)[number];

export const UI_ADAPTATIONS = ['STABLE', 'SIMPLIFY', 'EXPAND'] as const;
export type UiAdaptation = (typeof UI_ADAPTATIONS)[number];

export const cognitiveStateSchema = z.object({
  sessionId: z.string().min(1),
  ts: z.string().datetime(),
  /** Cognitive load proxy in [0,1] (0 = relaxed, 1 = overloaded). */
  loadLevel: z.number().min(0).max(1),
  /** Flow-state score in [0,1]. */
  flowScore: z.number().min(0).max(1),
  source: z.enum(COGNITIVE_SOURCES),
  /** Adaptation the client UI applied for this state. */
  adaptationApplied: z.enum(UI_ADAPTATIONS),
});
export type CognitiveState = z.infer<typeof cognitiveStateSchema>;

/** BCI adapter registration (PRD §3.2 — open API for EEG/fNIRS devices). */
export const bciAdapterSchema = z.object({
  adapterId: z.string().min(1),
  vendor: z.string().min(1),
  modalities: z.array(z.enum(['EEG', 'fNIRS'])).min(1),
  sampleRateHz: z.number().positive(),
});
export type BciAdapter = z.infer<typeof bciAdapterSchema>;
