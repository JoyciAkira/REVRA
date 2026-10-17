/**
 * Evidence hierarchy (PRD §0.1) and provenance events (PRD §0.2 — Provenance Preservation).
 *
 * Every result REVRA presents carries an explicit evidence label. The special
 * states DISPUTED / UNKNOWN / UNSUPPORTED are first-class: never hidden.
 */
import { z } from 'zod';

/** L0 Observed · L1 Inferred · L2 Empirically Validated · L3 Formally Proven */
export const EVIDENCE_LEVELS = ['L0', 'L1', 'L2', 'L3'] as const;
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];

/** Explicit special states — never silently resolved or hidden (PRD §0.1). */
export const SPECIAL_STATUSES = ['DISPUTED', 'UNKNOWN', 'UNSUPPORTED'] as const;
export type SpecialStatus = (typeof SPECIAL_STATUSES)[number];

export const verificationStateSchema = z.union([
  z.enum(EVIDENCE_LEVELS),
  z.enum(SPECIAL_STATUSES),
]);
export type VerificationState = EvidenceLevel | SpecialStatus;

/** Graceful Degradation labels (PRD §0.2): failure is explicit, never silent. */
export const DEGRADATION_WARNINGS = [
  'VERIFICATION_TIMEOUT',
  'PROOF_FAILED',
  'VERIFIER_UNAVAILABLE',
] as const;
export type DegradationWarning = (typeof DEGRADATION_WARNINGS)[number];

/**
 * Who acts on a result. The kind powers the AI Authority Boundary (PRD §0.2):
 * `ai` may propose (L1) but never promote its own output to L2/L3.
 */
export const actorKindSchema = z.enum(['engine', 'analyst', 'ai', 'symbolic', 'system']);
export type ActorKind = z.infer<typeof actorKindSchema>;

export const actorSchema = z.object({
  kind: actorKindSchema,
  id: z.string().min(1),
});
export type Actor = z.infer<typeof actorSchema>;

/**
 * Append-only provenance event. The full chain of origins (engine, version,
 * params, actor, transitions) is preserved — history is never rewritten.
 */
export const provenanceEventSchema = z.object({
  id: z.string(),
  ts: z.string().datetime(),
  actor: actorSchema,
  action: z.string().min(1),
  engine: z.string().optional(),
  engineVersion: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  /** Evidence artifact justifying a promotion — required for L1→L2 (No Silent Promotion). */
  evidenceRef: z.string().optional(),
  fromState: verificationStateSchema.optional(),
  toState: verificationStateSchema.optional(),
  note: z.string().optional(),
});
export type ProvenanceEvent = z.infer<typeof provenanceEventSchema>;

/** Total order over evidence levels; also serves as "is a level (not a special status)" check. */
export const LEVEL_ORDER: Record<EvidenceLevel, number> = { L0: 0, L1: 1, L2: 2, L3: 3 };
