/**
 * Temporal navigation contracts (PRD §3.2, §7 ReplayTimeline):
 * snapshots materializzati lungo la timeline, causal chain (perché, non solo
 * cosa), e branch — universi paralleli di analisi con merge a convergenza.
 */
import { verificationStateSchema } from './evidence.js';
import { z } from 'zod';

export const timelineSnapshotSchema = z.object({
  eventId: z.string(),
  ts: z.string().datetime(),
  action: z.string(),
  /** Stato dell'evidenza DOPO l'evento (replay cumulativo). */
  state: verificationStateSchema,
  warnings: z.array(z.string()),
  actor: z.string(),
  evidenceRef: z.string().optional(),
});
export type TimelineSnapshot = z.infer<typeof timelineSnapshotSchema>;

export const causalStepSchema = z.object({
  eventId: z.string(),
  action: z.string(),
  actor: z.string(),
  /** Evento che ha causato questo step (null per la submit iniziale). */
  causedBy: z.string().nullable(),
  /** Prova/motivazione del passaggio causale. */
  becauseEvidence: z.string().optional(),
  becauseNote: z.string().optional(),
  fromState: verificationStateSchema.optional(),
  toState: verificationStateSchema.optional(),
});
export type CausalStep = z.infer<typeof causalStepSchema>;

export const branchInfoSchema = z.object({
  branchId: z.string(),
  label: z.string().min(1),
  originResultId: z.string(),
  originEventId: z.string(),
  /** Il nuovo universo: un result indipendente che parte dall'origine. */
  branchedResultId: z.string(),
  ts: z.string().datetime(),
});
export type BranchInfo = z.infer<typeof branchInfoSchema>;
