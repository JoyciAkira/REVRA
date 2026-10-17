/**
 * Cross-engine proof reconciliation (PRD §3.1): discrepancies are shown as
 * DISPUTED with the evidence of both sides — never silently resolved.
 * Agreement unifies the proofs into a single verified certificate.
 */
import { z } from 'zod';

export const RECONCILIATION_OUTCOMES = ['UNIFIED', 'DISPUTED'] as const;
export type ReconciliationOutcome = (typeof RECONCILIATION_OUTCOMES)[number];

export const reconciliationReportSchema = z.object({
  id: z.string().min(1),
  outcome: z.enum(RECONCILIATION_OUTCOMES),
  resultIdA: z.string().min(1),
  resultIdB: z.string().min(1),
  /** Present on UNIFIED: the superseding merged result. */
  unifiedResultId: z.string().optional(),
  /** Present on DISPUTED: both sides are kept visible with their own evidence. */
  disputedSides: z
    .array(
      z.object({
        resultId: z.string(),
        engineSource: z.string(),
        state: z.string(),
        claim: z.unknown(),
      }),
    )
    .optional(),
  /** DISPUTED is explicit: a counterexample request is opened, not auto-resolved. */
  counterexampleRequested: z.boolean(),
  ts: z.string().datetime(),
});
export type ReconciliationReport = z.infer<typeof reconciliationReportSchema>;
