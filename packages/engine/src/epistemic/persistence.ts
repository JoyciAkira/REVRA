/**
 * Persistenza epistemic (F0.3): corpus pattern, ipotesi, causal edges e
 * co-occorrenze — snapshot validato zod per il restore.
 */
import { z } from 'zod';
import { causalEdgeSchema, hypothesisSchema } from '@revra/contracts';
import type { CorpusPattern } from './epistemic-engine.js';

export const corpusPatternSchema = z.object({
  patternId: z.string(),
  family: z.string(),
  arch: z.string(),
  firstSeenEngineSource: z.string(),
  confirmed: z.number().int().nonnegative(),
  falsified: z.number().int().nonnegative(),
  ts: z.string(),
});
export type CorpusPatternSnapshot = z.infer<typeof corpusPatternSchema>;

export const epistemicSnapshotSchema = z.object({
  patterns: z.array(corpusPatternSchema),
  hypotheses: z.array(hypothesisSchema),
  causalEdges: z.array(causalEdgeSchema),
  cooccurrences: z.array(z.object({ cause: z.string(), effect: z.string(), count: z.number().int().positive() })),
});
export type EpistemicSnapshot = z.infer<typeof epistemicSnapshotSchema>;
