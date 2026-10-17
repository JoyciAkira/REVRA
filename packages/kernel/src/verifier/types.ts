/**
 * Proof verifier seam (PRD §9 Formal Verification Stack). The kernel never
 * trusts a proof: it delegates machine checking to a ProofVerifier and reacts
 * to the outcome under the Graceful Degradation contract.
 */
import { z } from 'zod';
import { addressRangeSchema } from '@revra/contracts';

export const VERIFIER_OUTCOMES = [
  'VERIFIED',
  'PROOF_FAILED',
  'VERIFICATION_TIMEOUT',
  'VERIFIER_UNAVAILABLE',
] as const;
export type VerifierOutcome = (typeof VERIFIER_OUTCOMES)[number];

export interface VerifierRun {
  outcome: VerifierOutcome;
  detail?: string;
}

/** Input a caller supplies for checking; the verifier adds identity and outcome. */
export const certificateInputSchema = z.object({
  resultId: z.string().min(1),
  theorem: z.string().min(1),
  proofTerm: z.string().min(1),
  semanticModel: z.string().min(1),
  property: z.string().min(1),
  assumptions: z.array(z.string()),
  binaryHash: z.string().min(8),
  instructionRange: addressRangeSchema,
  arch: z.string().min(1),
});
export type CertificateInput = z.infer<typeof certificateInputSchema>;

export interface ProofVerifier {
  readonly name: string;
  readonly version: string;
  verify(cert: CertificateInput): Promise<VerifierRun>;
}
