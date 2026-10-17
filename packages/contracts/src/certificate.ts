/**
 * ProofCertificate — Bounded Guarantees (PRD §0.2): every L3 claim carries the
 * full proof metadata (binary hash, instruction range, arch, semantic model,
 * property, assumptions, verifier version, outcome).
 */
import { z } from 'zod';
import { addressRangeSchema } from './analysis.js';

export const PROOF_OUTCOMES = ['VERIFIED', 'PROOF_FAILED', 'VERIFICATION_TIMEOUT'] as const;
export type ProofOutcome = (typeof PROOF_OUTCOMES)[number];

export const proofCertificateSchema = z.object({
  id: z.string().min(1),
  resultId: z.string().min(1),
  /** Name of the proven property, e.g. "semantic-preservation". */
  theorem: z.string().min(1),
  /** Machine-checkable proof source (Lean 4 / Coq). */
  proofTerm: z.string().min(1),
  /** Declared semantic model the proof holds in, e.g. "lean4-imp-semantics@0.1". */
  semanticModel: z.string().min(1),
  /** Formal statement proved, in the vocabulary of the semantic model. */
  property: z.string().min(1),
  assumptions: z.array(z.string()),
  binaryHash: z.string().min(8),
  instructionRange: addressRangeSchema,
  arch: z.string().min(1),
  verifier: z.object({ name: z.string().min(1), version: z.string().min(1) }),
  outcome: z.enum(PROOF_OUTCOMES),
  generatedAt: z.string().datetime(),
});
export type ProofCertificate = z.infer<typeof proofCertificateSchema>;
