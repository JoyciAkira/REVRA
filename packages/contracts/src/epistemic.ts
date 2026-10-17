/**
 * Epistemic engine contracts (PRD §3.3, §7 Hypothesis + CausalLink):
 * ipotesi falsificabili generate autonomamente, causal reasoning separato
 * dalle correlazioni, self-improvement misurato.
 */
import { z } from 'zod';

export const HYPOTHESIS_STATUSES = ['PROPOSED', 'CONFIRMED', 'FALSIFIED'] as const;
export type HypothesisStatus = (typeof HYPOTHESIS_STATUSES)[number];

export const hypothesisSchema = z.object({
  id: z.string(),
  binaryHash: z.string(),
  arch: z.string(),
  /** Predizione falsificabile: famiglia, simbolo atteso, range. */
  prediction: z.object({
    family: z.string(),
    expectedEngineSource: z.string().optional(),
    rationale: z.string(),
  }),
  confidence: z.number().min(0).max(1),
  generatedAt: z.string().datetime(),
  /** Tempo per la prima insight (target PRD: <30s). */
  generatedInMs: z.number().nonnegative(),
  status: z.enum(HYPOTHESIS_STATUSES),
  patternId: z.string(),
});
export type Hypothesis = z.infer<typeof hypothesisSchema>;

/** Metodo con cui una relazione è stabilita: differenziale = causale. */
export const CAUSAL_METHODS = ['differential', 'co-occurrence'] as const;
export type CausalMethod = (typeof CAUSAL_METHODS)[number];

export const causalEdgeSchema = z.object({
  cause: z.string(),
  effect: z.string(),
  method: z.enum(CAUSAL_METHODS),
  observations: z.number().int().positive(),
  ts: z.string().datetime(),
});
export type CausalEdge = z.infer<typeof causalEdgeSchema>;
