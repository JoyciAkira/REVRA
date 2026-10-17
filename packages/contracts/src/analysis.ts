/**
 * AnalysisResult — a claim about a binary region (PRD §7 Ontology, Annotation/
 * AnalysisResult). Immutable snapshots; every transition appends provenance.
 */
import { z } from 'zod';
import { provenanceEventSchema, verificationStateSchema } from './evidence.js';

export const addressRangeSchema = z.object({
  start: z.string().min(1), // hex string, e.g. "0x401000"
  end: z.string().min(1),
});
export type AddressRange = z.infer<typeof addressRangeSchema>;

export const claimSchema = z.object({
  kind: z.string().min(1), // 'decompilation' | 'symbol' | 'type' | 'observed-bytes' | ...
  payload: z.unknown(),
});
export type Claim = z.infer<typeof claimSchema>;

export const analysisResultSchema = z.object({
  id: z.string().min(1),
  /** Proprietario (multi-tenancy F0.2): iniettato dal layer auth, mai dal client. */
  tenantId: z.string().min(1).optional(),
  binaryHash: z.string().min(8),
  arch: z.string().min(1),
  addressRange: addressRangeSchema,
  engineSource: z.string().min(1),
  claim: claimSchema,
  verification: z.object({
    state: verificationStateSchema,
    warnings: z.array(z.string()).default([]),
  }),
  provenance: z.array(provenanceEventSchema).min(1),
});
export type AnalysisResult = z.infer<typeof analysisResultSchema>;

export const submitResultInputSchema = analysisResultSchema.omit({
  id: true,
  provenance: true,
  verification: true,
});
export type SubmitResultInput = z.infer<typeof submitResultInputSchema>;

/** Claim kinds eligible for formal verification by default (drives Eligibility Coverage). */
export const DEFAULT_ELIGIBLE_CLAIM_KINDS = ['decompilation'] as const;
